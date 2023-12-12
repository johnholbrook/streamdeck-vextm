/**
 * @file pi.js
 * @author John Holbrook
 * JS code for the property inspector – send address and API key to the plugin as needed
*/

// global variables
var websocket = null; // websocket object used to talk to the stream deck software
var context = null; // opaque value provided by the Stream Deck software
var action = null; // the action identifier
var actionInfo = null; // Object with info about the current action

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
        "context": context,
        "payload": {
            "message": message
        }
    });
}

/**
 * Set up the connection to the Stream Deck software. Called automatically when the PI is loaded.
 * @param {*} inPort - port to talk to the stream deck software via websockets
 * @param {*} inPropertyInspectorUUID - A unique identifier string to register Property Inspector with Stream Deck software
 * @param {*} inRegisterEvent - The event type that should be used to register the plugin once the WebSocket is opened. For Property Inspector this is "registerPropertyInspector"	
 * @param {*} inInfo - A json object containing information about the plugin.
 * @param {*} inActionInfo - A json object containing information about the action.
 */
function connectElgatoStreamDeckSocket(inPort, inPropertyInspectorUUID, inRegisterEvent, inInfo, inActionInfo){
    // create a new websocket on the appropriate port
    websocket = new WebSocket("ws://127.0.0.1:" + inPort);

    // register the PI with the stream deck software
    websocket.onopen = function(){
        // WebSocket is connected, register the Property Inspector
        var json = {
            "event": inRegisterEvent,
            "uuid": inPropertyInspectorUUID
        };

        websocket.send(JSON.stringify(json));
    };

    // set the context
    context = inPropertyInspectorUUID;

    // set the action
    actionInfo = JSON.parse(inActionInfo);
    action = actionInfo.action; 
    // alert(`Action Settings: ${JSON.stringify(actionInfo.payload.settings)}`);

    // listen for messages from the stream deck software
    websocket.onmessage = function(evt){
        let data = JSON.parse(evt.data);
        log(`PI received message: ${data.event}`);

        // if the plugin sends a global settings update, update the UI
        if (data.event == "didReceiveGlobalSettings"){
            document.querySelector("#tm-addr-input").value = data.payload.settings.address ? data.payload.settings.address : "";
            document.querySelector("#tm-key-input").value = data.payload.settings.tm_key ? data.payload.settings.tm_key : "";
            document.querySelector("#field-set-id").value = data.payload.settings.fieldset ? data.payload.settings.fieldset : 1;
        }
    };

    // show the correct action-specific options, if any
    if (action == "us.johnholbrook.vextm.select-display"){
        document.querySelector("#info-select-wrapper").style.display = "none";
        document.querySelector("#display-select").value = actionInfo.payload.settings.selected_display ? actionInfo.payload.settings.selected_display : "INTRO";
    }
    else if (action == "us.johnholbrook.vextm.match-info"){
        document.querySelector("#display-select-wrapper").style.display = "none";
        document.querySelector("#info-select").value = actionInfo.payload.settings.selected_info ? actionInfo.payload.settings.selected_info : "1";
    }
    else{
        document.querySelector("#display-select-wrapper").style.display = "none";
        document.querySelector("#info-select-wrapper").style.display = "none";
        document.querySelector("#action-settings").style.display = "none";
    }

    // after 200ms, ask for the global settings
    // this is stupid, but the "inActionInfo" parameter only appears to contain local settings
    // it appears the only way to get the global settings is to send a "getGlobalSettings" event
    // the 200ms delay is to give the PI time to register with the stream deck software
    setTimeout(() => {
        send({
            "event": "getGlobalSettings",
            "context": context
        });
    }, 200);
}

/**
 * Send the updatted address and password to the plugin.
 */
function updateSettings(){
    let address = document.querySelector("#tm-addr-input").value;
    let tm_key = document.querySelector("#tm-key-input").value;
    let field_set = document.querySelector("#field-set-id").value;
    log(`PI updating settings: ${address} ${tm_key}`);
    send({
        "event": "setGlobalSettings",
        "context": context,
        "payload": {
            "address": address ? address : "localhost",
            "tm_key": tm_key,
            "fieldset": field_set
        }
    });
}

/**
 * Send the selected display to the plugin
 */
function updateSelectedDisplay(){
    let selection = document.querySelector("#display-select").value;
    log(`PI Setting display to ${selection}`);
    send({
        "event": "setSettings",
        "context": context,
        "payload": {
            "selected_display": selection
        }
    });
}

/**
 * Send the selected info to display on teh match info action to the plugin
 */
function updateSelectedInfo(){
    let selection = document.querySelector("#info-select").value;
    log(`PI Setting Match Info to ${selection}`);
    send({
        "event": "setSettings",
        "context": context,
        "payload": {
            "selected_info": selection
        }
    });
}

document.addEventListener("DOMContentLoaded", function() {
    document.querySelector("#tm-addr-input").onchange = updateSettings;
    document.querySelector("#tm-key-input").onchange = updateSettings;
    document.querySelector("#field-set-id").onchange = updateSettings;
    document.querySelector("#reconnect").onclick = updateSettings;
    document.querySelector("#display-select").onchange = updateSelectedDisplay;
    document.querySelector("#info-select").onchange = updateSelectedInfo;
});