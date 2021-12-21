/**
 * @file main.js
 * @author John Holbrook
 * Main file for the plugin.
 */

const WebSocket = require("ws");
const dialog = require("dialog");
const VexTMWebsocket = require("./tm_websocket.js");
// const { readFileSync } = require("fs");

// global variables
var websocket = null; // websocket object used to talk to the stream deck software
var pluginUUID = null; // opaque value provided by the Stream Deck software
var tm_addr = null; // address of the TM server
var tm_pass = null; // TM admin password
var TM = null; // object representing connection to the TM server
var actions = []; // list of all the active actions
var selectedDisplays = {}; // object containing the display associated with each "select display" action
var tm_conn_established = false; // are we connected to tournament manager?


/**
 * Send some JSON data to the stream deck software.
 * @param {Object} message - the JSON data to send
 */
 function send(message){
    websocket.send(JSON.stringify(message));
}

/**
 * Write to the stream deck log.
 * @param {String} message 
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
 * Remove an item from an array of Objects
 * @param {Array} arr – array to remove the item from
 * @param {Object} key – value to be removed
 * @returns a copy of arr with (the first instace of) value removed
 */
 function removeItem(arr, key){
    let idx = -1;
    let sKey = JSON.stringify(key)
    // console.log(sKey)
    for (let i=0; i<arr.length; i++){
        // let sCurr = JSON.stringify(arr[i])
        if (JSON.stringify(arr[i]) == sKey){
            idx = i;
            break;
        }
    }
    console.log(idx);
    if (idx >= 0){
        arr.splice(idx, 1);
    }
    return arr;
}

/**
 * Convert from an integer number of seconds to a time string (MM:SS)
 * @param {Int} s 
 * @returns a time string (MM:SS)
 */
function secsToTime(s){
    let minutes = Math.floor(s/60);
    let seconds = s - (60*minutes);
    if (seconds<10){
        seconds = "0" + seconds;
    }
    return `${minutes}:${seconds}`;
}

/**
 * Delay (synchronous when used with await)
 * @param {Int} delayInms number of ms to delay
 * @returns a pronise that resolves after the specified time
 */
function delay(delayInms) {
    return new Promise(resolve => {
      setTimeout(() => {
        resolve(2);
      }, delayInms);
    });
}

/**
 * Main function for the plugin.
 */
function main(){
    let inPort = process.argv[3];
    pluginUUID = process.argv[5];
    let inRegisterEvent = process.argv[7];
    let inInfo = JSON.parse(process.argv[9]);

    // dialog.info(JSON.stringify(inInfo));

    // create a new websocket on the appropriate port
    websocket = new WebSocket(`ws://127.0.0.1:${inPort}`);

    // register the plugin with the Stream Deck Software
    websocket.on("open", () => {
        send({
            "event": inRegisterEvent,
            "uuid" : pluginUUID
        });

        // dialog.info("Registered with SD");

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

        // recieve the TM address/password
        if (json.event == "didReceiveGlobalSettings"){
            tm_addr = json.payload.settings.address;
            tm_pass = json.payload.settings.password;
            tm_fs = json.payload.settings.fieldset;

            // try to connect to tournament manager
            tm_conn_established = false;
            while (!tm_conn_established){
                try{
                    // (re) create the TM object
                    if (TM){
                        TM.close();
                    }
                    TM = null;
                    TM = new VexTMWebsocket(tm_addr, tm_pass, tm_fs, log);
                    // if (TM){
                    //     TM.setCredentials(tm_addr, tm_pass);
                    // }
                    // else{
                    //     TM = new VexTMWebsocket(tm_addr, tm_pass, log);
                    // }
                    await TM.init();
                    tm_conn_established = true;
                }
                catch(e){
                    log(`Error connecting to TM: ${e.message}. Retrying in 10 seconds...`);
                    // display an alert on all actions
                    actions.forEach(action => {
                        send({
                            "event": "showAlert",
                            "context": action.uuid
                        });
                    });
                    await delay(10000);
                }
            }

            // callback to execute when the match info changes
            TM.onMatchInfoChange(data => {
                // update the match info displayed on any start/end actions
                let info = `${data.match}\n${data.state}\n${secsToTime(data.time)}`;
                actions.forEach(action => {
                    if (action.action == "us.johnholbrook.vextm.start-end"){
                        // send match into text (match, state, time)
                        send({
                            "event": "setTitle",
                            "context": action.uuid,
                            "payload": {
                                "title": info
                            }
                        });

                        // set the appropriate background image
                        // (state 0 is "play", state 1 is "stop")
                        send({
                            "event": "setState",
                            "context": action.uuid,
                            "payload": {
                                "state": data.isRunning ? 1 : 0
                            }
                        });
                    }
                });
            });

            // if the connection to TM is closed...
            TM.onClose(() => {
                // ask the stream deck software for the credentials and start trying to reconnect
                send({
                    "event": "getGlobalSettings",
                    "context": pluginUUID
                });
            });
        }

        // keypress handler
        // if there's no connection to the server, don't do anything in response to a keypress
        else if (json.event == "keyDown" && tm_conn_established){
            // do the right thing based on which action was triggered
            switch (json.action){
                case "us.johnholbrook.vextm.queue-next":
                    TM.queueNextMatch();
                    break;
                case "us.johnholbrook.vextm.queue-prev":
                    TM.queuePrevMatch();
                    break;
                case "us.johnholbrook.vextm.queue-driving":
                    TM.queueDrivingSkills(1);
                    break;
                case "us.johnholbrook.vextm.queue-prog":
                    TM.queueProgrammingSkills(1);
                    break;
                case "us.johnholbrook.vextm.start-end":
                    TM.startOrEnd();
                    break;
                case "us.johnholbrook.vextm.reset":
                    TM.resetTimer();
                    break;
                case "us.johnholbrook.vextm.select_display":
                    // log(`Select display: ${json.context}`);
                    // log(JSON.stringify(selectedDisplays));
                    // log(JSON.stringify(selectedDisplays[json.context]));
                    TM.selectDisplay(JSON.stringify(selectedDisplays[json.context]));
                    break;
            }
        }

        // register a new start/end action when it appears
        else if (json.event == "willAppear"){
            actions.push({
                uuid: json.context,
                action: json.action
            });
            log(JSON.stringify(actions));
            if (json.action == "us.johnholbrook.vextm.select_display"){
                // keep track of which display should be selected when this action is triggered
                selectedDisplays[json.context] = selectedDisplays[json.context] ? json.payload.settings.selected_display : 2;
                
                log(JSON.stringify(selectedDisplays));
            }
        }
        // deregister a start/end action when it disappears
        else if (json.event == "willDisappear"){
            actions = removeItem(actions, {
                uuid: json.context,
                action: json.action
            });
            log(JSON.stringify(actions));
            if (json.action == "us.johnholbrook.vextm.select_display"){
                // stop keeping track of which display should be selected when this action is triggered
                delete selectedDisplays[json.context];
                log(JSON.stringify(selectedDisplays));
            }
        }

        else if (json.event == "didReceiveSettings"){
            // update the display to be selected when this action is triggered
            if (json.action == "us.johnholbrook.vextm.select_display"){
                // keep track of which display should be selected when this action is triggered
                selectedDisplays[json.context] = json.payload.settings.selected_display;
                log(JSON.stringify(selectedDisplays));
            }
        }


    })

}
// call the main function
main();