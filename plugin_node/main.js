/**
 * @file main.js
 * @author John Holbrook
 * Main file for the plugin.
 */

const WebSocket = require("ws");
const { Client, FieldsetQueueSkillsType, MatchRound } = require("vex-tm-client");
const auth = require("./auth.json");

// global variables
var websocket = null; // websocket object used to talk to the stream deck software
var pluginUUID = null; // opaque value provided by the Stream Deck software
var tm_addr = null; // address of the TM server
var tm_key = null; // TM API key
var tm_fs_id = null; // ID of the field set we're connecting to
var tm_fs = null;
var tm_fs_conn = null; // object representing websocket connection to the field set
var tm_client = null; // object representing connection to the TM server
var actions = []; // list of all the active actions
var selectedDisplays = {}; // object containing the display associated with each "select display" action
var skillsFields = {}; // object containing the field to queue a skills match on for each "queue driving" or "queue programming" action
var matchInfoActionPreferences = {}; // object containing user preferences for what to show on each "match info" action
var tm_conn_established = false; // are we connected to tournament manager?
var fields = null; // list of fields in the selected field set
var fs_state = { // object representing the current state of the field set
    selectedDisplay : null,
    currentMatchName: null,
    matchState: null,
    currentField: null
}


// ID and name of each TM display
const display_id_names = {
    "BLANK": "None",
    "LOGO": "Logos",
    "INTRO": "Intro",
    "IN_MATCH": "In-Match",
    "RESULTS": "Saved\nMatch\nResults",
    "SCHEDULE": "Schedule",
    "RANKINGS": "Rankings",
    "SC_RANKINGS": "Skills\nRankings",
    "ALLIANCE_SELECTION": "Alliance\nSelection",
    "BRACKET": "Elim\nBracket",
    "AWARD": "Slides",
    "INSPECTION": "Insp."
}

/**
 * Send some JSON data to the stream deck software.
 * @param {Object} message the JSON data to send
 */
 function send(message){
    websocket.send(JSON.stringify(message));
}

/**
 * Write to the stream deck log.
 * @param {String} message message to write to the log
 */
function log(message){
    send({
        "event": "logMessage",
        "context": pluginUUID,
        "payload": {
            "message": message
        }
    });
}

/**
 * Set the title text on the specified action
 * @param {String} context UUID of action to set title on
 * @param {String} title title to write
 */
function setTitle(context, title){
    send({
        "event": "setTitle",
        "context": context,
        "payload": {
            "title": title
        }
    });
}

/**
 * Set the state of the specified action
 * @param {String} context UUID of the action to set state on
 * @param {Number} state 0 or 1, depending on the desired state
 */
function setState(context, state){
    send({
        "event": "setState",
        "context": context,
        "payload": {
            "state": state
        }
    });
}

/**
 * Remove an item from an array of Objects
 * @param {Array} arr array to remove the item from
 * @param {Object} key value to be removed
 * @returns a copy of arr with (the first instace of) value removed
 */
 function removeItem(arr, key){
    let idx = -1;
    let sKey = JSON.stringify(key)
    for (let i=0; i<arr.length; i++){
        if (JSON.stringify(arr[i]) == sKey){
            idx = i;
            break;
        }
    }
    if (idx >= 0){
        arr.splice(idx, 1);
    }
    return arr;
}

/**
 * Delay (synchronous when used with await)
 * @param {Int} delayInms number of ms to delay
 * @returns a promise that resolves after the specified time
 */
function delay(delayInms) {
    return new Promise(resolve => {
      setTimeout(() => {
        resolve(2);
      }, delayInms);
    });
}

/**
 * Update the content of all visible "match info" actions.
 */
function updateMatchInfo(){
    let info = `${fs_state.currentMatchName}\n${fs_state.currentField}\n${fs_state.matchState}`;
    let options = {
        1: info,
        2: fs_state.currentMatchName,
        3: fs_state.currentField,
        4: fs_state.matchState
    }

    actions.forEach(action => {
        if (action.action == "us.johnholbrook.vextm.match-info"){
            let preference = matchInfoActionPreferences[action.uuid];
            setTitle(action.uuid, options[preference]);
        }
    });
}

/**
 * Construct a "short name" for the specified match to be shown on "match info" actions
 * @param {Object} match object representing the match sent by TM server
 * @returns String
 */
function buildMatchName(match){
    if (match.round == "PRACTICE") return `P ${match.match}`;
    else if (match.round == "QUAL") return `Q ${match.match}`;
    else if (match.round == "TOP_N") return `F ${match.match}`; // IQ finals
    else if (match.round == "TIERED_TOP_N_QF") return `QF ${match.match}` // ADC Quarterfinals
    else if (match.round == "TIERED_TOP_N_SF") return `SF ${match.match}` // ADC Semifinals
    else if (match.round == "TIERED_TOP_N_F") return `F ${match.match}` // ADC Finals
    else return `${match.round} ${match.instance}-${match.match}`;
}

/**
 * Main function for the plugin.
 */
function main(){
    let inPort = process.argv[3];
    pluginUUID = process.argv[5];
    let inRegisterEvent = process.argv[7];
    let inInfo = JSON.parse(process.argv[9]);

    // create a new websocket on the appropriate port
    websocket = new WebSocket(`ws://127.0.0.1:${inPort}`);

    // register the plugin with the Stream Deck Software
    websocket.on("open", () => {
        send({
            "event": inRegisterEvent,
            "uuid" : pluginUUID
        });

        log("Hello from plugin!")

        // hack to get the global settings
        setTimeout(() => {
            send({
                "event": "getGlobalSettings",
                "context": pluginUUID
            });
        }, 200);
    });

    // message handler
    websocket.on("message", async data => {
        let json = JSON.parse(data);
        log(`Plugin recieved event: ${json.event}`);

        // recieve the TM address/key
        if (json.event == "didReceiveGlobalSettings"){
            tm_addr = json.payload.settings.address;
            tm_key = json.payload.settings.tm_key;
            tm_fs_id = json.payload.settings.fieldset;
            // log(`Plugin recieved addr and key as: ${tm_addr}, ${tm_key}`);

            // if we're already connected to TM, disconnect to try again
            if (tm_fs_conn){
                tm_fs_conn.disconnect();
                tm_fs_conn = null;
                tm_fs = null;
            }
            tm_conn_established = false;
            // while (!tm_conn_established){
                // try to connect to tournament manager
                tm_client = new Client({
                    address: `http://${tm_addr}`,
                    authorization: {
                    client_id: auth.client_id,
                    client_secret: auth.client_secret,
                    grant_type: "client_credentials",
                    expiration_date: auth.expiration_date,
                    },
                    clientAPIKey: tm_key
                });

                let conn_result = await tm_client.connect();
                if (conn_result.success){
                    log("Connected to TM!");
                    tm_conn_established = true;
                }
                else {
                    log("Failed to connect to TM, try again by clicking 'RECONNECT'");
                    return;
                    // log("Failed to connect to TM, trying again in 10 seconds")
                    // await delay(10000);
                }
            // }
            
            // connect to speficied field set
            let fieldsets = await tm_client.getFieldsets()
            tm_fs = fieldsets.data.find(s => s.id == Number(tm_fs_id));
            
            // get list of fields in this set
            fields = (await tm_fs.getFields()).data;
            fields.push({id:0, name:""});
            log(JSON.stringify(fields));

            tm_fs_conn = await tm_fs.connect();
            tm_fs.on("message", event => { // handler for messages from TM
                // log(JSON.stringify(event));

                if (event.type == "fieldMatchAssigned"){
                    fs_state.currentField = fields.find(f => f.id == Number(event.fieldID)).name;
                    let match = event.match;
                    fs_state.currentMatchName = buildMatchName(match);
                    updateMatchInfo();
                }

                else if (event.type == "fieldActivated"){
                    fs_state.currentField = fields.find(f => f.id == Number(event.fieldID)).name;
                    updateMatchInfo();
                }

                else if (event.type == "matchStarted"){
                    fs_state.matchState = "RUNNING";
                    updateMatchInfo();
                }

                else if (event.type == "matchStopped"){
                    fs_state.matchState = "STOPPED";
                    updateMatchInfo();
                }

                else if (event.type == "audienceDisplayChanged"){
                    if (event.display == "IN_MATCH"){
                        fs_state.matchState = "PRESTART";
                        updateMatchInfo();
                    }

                    // update the state of any "Select Display" actions when the selected audience display changes
                    fs_state.selectedDisplay = event.display;

                    Object.keys(selectedDisplays).forEach(uuid => {
                        let this_action_disp = selectedDisplays[uuid];
                        setState(uuid, (this_action_disp == event.display) ? 0 : 1);
                    });
                }
            });

        }

        // keypress handler
        // if there's no connection to the server, don't do anything in response to a keypress
        else if (json.event == "keyDown" && tm_conn_established){
            // do the right thing based on which action was triggered
            switch (json.action){
                case "us.johnholbrook.vextm.queue-next":
                    tm_fs.queueNextMatch();
                    break;
                case "us.johnholbrook.vextm.queue-prev":
                    // tm_fs.queuePreviousMatch();
                    tm_fs.send({cmd:"queuePrevMatch"});
                    break;
                case "us.johnholbrook.vextm.queue-driving":
                    tm_fs.queueSkills(FieldsetQueueSkillsType.Driver);
                    break;
                case "us.johnholbrook.vextm.queue-prog":
                    tm_fs.queueSkills(FieldsetQueueSkillsType.Programming);
                    break;
                case "us.johnholbrook.vextm.move-match":
                    // TM.moveMatchToField(skillsFields[json.context]);
                    break;
                case "us.johnholbrook.vextm.start-match":
                    tm_fs.startMatch();
                    break;
                case "us.johnholbrook.vextm.end-early":
                    tm_fs.endMatchEarly();
                    break;
                case "us.johnholbrook.vextm.start-end":
                    // TM.startOrEnd();
                    break;
                case "us.johnholbrook.vextm.reset":
                    tm_fs.resetTimer();
                    break;
                case "us.johnholbrook.vextm.select-display":
                    tm_fs.setAudienceDisplay(selectedDisplays[json.context]);
                    break;
            }
        }

        // when a "select display" key is released, update its state again
        else if (json.event == "keyUp"){
            if (json.action == "us.johnholbrook.vextm.select-display"){
                let this_action_disp = selectedDisplays[json.context]
                setState(json.context, (this_action_disp == fs_state.selectedDisplay) ? 0 : 1);
            }
        }

        // register a new start/end action when it appears
        else if (json.event == "willAppear"){
            actions.push({
                uuid: json.context,
                action: json.action
            });
            // log(JSON.stringify(actions));
            if (json.action == "us.johnholbrook.vextm.select-display"){
                // keep track of which display should be selected when this action is triggered
                selectedDisplays[json.context] = json.payload.settings.selected_display ? json.payload.settings.selected_display : "INTRO";
                
                // Set the title of the action according to the selected display
                setTitle(json.context, display_id_names[json.payload.settings.selected_display]);
            }
            else if (json.action == "us.johnholbrook.vextm.match-info"){
                // keep track of what info should be shown on this action
                matchInfoActionPreferences[json.context] = json.payload.settings.selected_info ? json.payload.settings.selected_info : 1;
                
                // show the selected info on this action
                if (tm_conn_established) updateMatchInfo();
            }
        }

        // deregister a start/end action when it disappears
        else if (json.event == "willDisappear"){
            actions = removeItem(actions, {
                uuid: json.context,
                action: json.action
            });
            // log(JSON.stringify(actions));
            if (json.action == "us.johnholbrook.vextm.select-display"){
                // stop keeping track of which display should be selected when this action is triggered
                delete selectedDisplays[json.context];
                // log(JSON.stringify(selectedDisplays));
            }
            else if (["us.johnholbrook.vextm.queue-driving", "us.johnholbrook.vextm.queue-prog", "us.johnholbrook.vextm.move-match"].includes(json.action)){
                delete skillsFields[json.context];
            }
            else if (json.action == "us.johnholbrook.vextm.match-info"){
                delete matchInfoActionPreferences[json.context];
            }
        }

        else if (json.event == "didReceiveSettings"){
            // update the display to be selected when this action is triggered
            if (json.action == "us.johnholbrook.vextm.select-display"){
                // keep track of which display should be selected when this action is triggered
                selectedDisplays[json.context] = json.payload.settings.selected_display;

                // Set the title of the action according to the selected display
                setTitle(json.context, display_id_names[json.payload.settings.selected_display]);
            }

            // update the info to be shown on this "match info" action
            else if (json.action == "us.johnholbrook.vextm.match-info"){
                // keep track of what info should be shown on this action
                matchInfoActionPreferences[json.context] = json.payload.settings.selected_info;

                // show the selected info on this action
                if (tm_conn_established) updateMatchInfo();
            }
        }

    }); // end of websocket message handler
} // end of function 'main'

// call the main function
main();