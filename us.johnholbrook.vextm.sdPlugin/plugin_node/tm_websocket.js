/**
 * @file tm_websocket.js
 * @author John Holbrook
 * Provides a class to interact with VEX TM via websockets.
 */

const FormData = require("form-data");
const { promisify } = require("util");
const WebSocket = require("ws");
const protobuf = require('protobufjs');

/**
 * @class VexTMWebsocket
 * @classdesc Provides a class to interact with VEX TM via websockets.
 */
module.exports = class VexTMWebsocket{
    /**
     * VexTMWebsocket constructor
     * @param {String} address – TM server address
     * @param {String} password – TM admin password
     * @param {Number} fieldset - ID of the field set to control
     * @param {Function} log – function to send log data to
     */
    constructor(address, password, fieldset, log=console.log){

        this.address = address; // address of the TM server
        this.password = password; // TM admin password
        this.fieldset = fieldset; // ID of the field set to connect to
        this.log = log; // function to send log data to

        this.socket = null; // websocket object used to talk to the TM server

        this.cookie = null; // session cookie returned by the TM server
        this.cookie_expiration = null; // expiration time of the session cookie

        this.pb = null; // protobuf schema
        this.fs_notice = null; // protobuf message type "FieldSetNotice"
        this.fs_request = null; // protobuf message type "FieldSetRequest"

        this.currentFieldId = null; // ID of the current field
        this.matchRunning = false; // whether a match is currently running
        this.currentMatch = null; // name of the match currently queued or running
        this.currentState = null; // state of the current match (AUTO, DRIVER, DISABLED, or TIMEOUT)
        this.currentMatchTime = 0; // time (in seconds) remaining in the current match
        this.currentDisplay = null; // ID of the screen currently showing on the audience display
        this.fieldList = null; // list of all fields and associated IDs

        this.onMatchInfoChangeCallback = null; // function to call when the current match info (match number, state, or time) changes
        this.onDisplaySelectedCallback = null; // function to call when a new display is selected
        this.onCloseCallback = null; // function to call when the connection to TM is closed
    }

    /**
     * Set the address and password
     * @param {String} address 
     * @param {String} password 
     */
    setCredentials(address, password){
        this.address = address;
        this.password = password;
    }

    /**
     * Authenticate with the TM server.
     */
    async _authenticate(){
        // send form data to server
        let form = new FormData();
        form.append("user", "admin");
        form.append("password", this.password)
        form.append("submit", "");
        let submitForm = promisify((addr, callback) => form.submit(addr, callback));
        let cookie_text = (await submitForm(`http://${this.address}/admin/login`)).headers['set-cookie'][0];
        
        // extract the session cookie
        let cookie_data = cookie_text.split(';')[0].split('"')[1];
        this.cookie = `user="${cookie_data}"`;

        // extract the expiration time
        let cookie_expiration = cookie_text.split(';')[1].split('=')[1];
        let expiration_date = new Date(cookie_expiration);
        this.cookie_expiration = expiration_date;
    }

    /**
     * Establish a websocket connection to the TM server
     * @param {Boolean} force - force-reinitialize the connection (default: false)
     */
    async _connectWebsocket(force=false){
        // if the cookie is missing or expired, authenticate
        if(!this.cookie || this.cookie_expiration < new Date()){
            await this._authenticate();
            // now delete the websocket so we will have to recreate it
            this.close();
            this.websocket = null;
        }

        if (force){
            this.close();
            this.websocket = null;
        }

        // if the websocket is already open, do nothing
        if (this.websocket){
            return;
        }

        // open and parse the protobuf schema
        this.pb = await protobuf.load("./plugin_node/fieldset.proto");
        this.fs_notice = this.pb.lookupType("FieldSetNotice");
        this.fs_request = this.pb.lookupType("FieldSetRequest");

        this.websocket = new WebSocket(`ws://${this.address}/fieldsets/${this.fieldset}`, {
            headers: {
                Cookie: this.cookie
            }
        });

        this.websocket.on('open', () => {
            this.log("Websocket connected to TM");

            // send handshake to TM
            let hs = this._generateHandshake();
            this.log("Initiating handshake...");
            this._send(hs);
        });

        this.websocket.on('close', () => {
            this.log("Websocket disconnected from TM");
            this.onCloseCallback();
        });

        this.websocket.on('message', async event => {
            this._messageHandler(event);
            
            // let data = JSON.parse(event.toString());
            // this._messageHandler(data);
        });
    }

    /**
     * Generates the "handshake message" needed to send to TM.
     * The message is 128 bytes long, namely:
     * - 7 bytes of padding (content irrelevant)
     * - Current UNIX timestamp in seconds since epoch (little-endian). Must be within 300s of TM server's time for handshake to be accepted.
     * - 117 bytes of padding (content irrelevant)
     * Yes, really. ¯\_(ツ)_/¯
     */
    _generateHandshake(){
        let unixTime = (Math.floor(Date.now() / 1000)).toString(16); // unix timestamp in big-endian hex
        
        // create byte array
        let hs = new Uint8Array(128);

        // write time to byte array (little-endian)
        hs[7]  = parseInt(unixTime.slice(6,8), 16);
        hs[8]  = parseInt(unixTime.slice(4,6), 16);
        hs[9]  = parseInt(unixTime.slice(2,4), 16);
        hs[10] = parseInt(unixTime.slice(0,2), 16);
        
        return hs;
    }

    /**
     * "Unmangles" a message recieved from the TM server into something decodable as a protobuf
     * @param {Buffer} raw_data – Data to unmangle
     * @returns unmangled data, which can be interpreted as a protpbuf
     */
    _unmangle(raw_data){
        let magic_number = raw_data[0] ^ 229;
        // console.log("Magic number: ", magic_number);

        let unmangled_data = Buffer.alloc(raw_data.length - 1);
        for (let i=1; i<raw_data.length; i++){
            unmangled_data[i-1] = raw_data[i] ^ magic_number;
        }

        return unmangled_data;
    }

    /**
     * "Mangles" a message before it can be sent to TM (the inverse of _unmangle above)
     * @param {Buffer} data - (protobuf) data to be mangled
     * @param {Int8} magic_number - magic number to use (pick any value or omit to use the default of 123)
     * @returns mangled data to be sent to TM
     */
    _mangle(data, magic_number = 123){
        let mangled_data = Buffer.alloc(data.length + 1);

        mangled_data[0] = magic_number ^ 229;

        for (let i=1; i<mangled_data.length; i++){
            mangled_data[i] = data[i-1] ^ magic_number;
        }

        return mangled_data;
    }

    /**
     * Generates a match name as displayed in TM (e.g. "Q123" or "SF 1-1")
     * from a V3MatchTuple object 
     * @param {Object} match 
     * @returns Name of the match as displayed in TM
     */
    _buildMatchName(match){
        // this.log(JSON.stringify(match.toJSON()))
        const elim_rounds = ["R128", "R64", "R32", "R16", "QF", "SF", "F"];

        if (match.round == "QUAL") return `Q${match.match}`;
        else if (elim_rounds.includes(match.round)) return `${match.round} ${match.instance}-${match.match}`;
        else if (match.round == "TOP_N") return `F ${match.match}` // IQ finals
        else if (match.round == "PRACTICE") return "P0"
        else if (match.round == "TIMEOUT") return "TO"
        else if (match.round == "SKILLS"){
            // RIP to the name "Programming Skills", 2007 - 2023 :(
            return match.instance == 2 ? "D Skills" : "A Coding";
        }
        else return "OTHER"
    }

    /**
     * Process a message from the TM server
     * @param {Object} message – the message to handle
     */
    async _messageHandler(message){
        let unmangled = this._unmangle(message);
        let decoded = this.fs_notice.decode(unmangled);

        // log the message unless it's a "timeUpdated" message (those come too frequently)
        if (decoded.id != 6) this.log(JSON.stringify(decoded.toJSON()));

        if (decoded.id == 8){ // match queued
            // update the current field ID
            this.currentFieldId = decoded.fieldId ? decoded.fieldId : 0;

            // update the match name
            this.currentMatch = decoded.match ? this._buildMatchName(decoded.match.toJSON()) : "NONE";

            this._whenMatchInfoChanged();
        }
        else if (decoded.id == 1){ // match started
            let state = "foo";
            if (this.currentMatch == "TO") state = "TIMEOUT"; // timeout
            else if ([15, 14, 45, 44].includes(this.currentMatchTime)) state = "AUTO"; // VRC or VEXU auto
            else if ([60, 59].includes(this.currentMatchTime)){
                if (this.currentMatch == "A Coding") state = "AUTO"; // programming skills
                else state = "DRIVER"; // driving skills or VIQC teamwork
            }
            else state = "DRIVER"; // otherwise just assume driver
            this.log(`State: ${state}; ${this.currentMatchTime}`);
            
            this.matchRunning = true;
            this.currentState = state;
            // this.currentState = "ACTIVE";
            this.currentFieldId = decoded.fieldId;
            this._whenMatchInfoChanged();
        }
        else if (decoded.id == 2 || decoded.id == 5){ // match stopped or aborted
            this.matchRunning = false;
            this.currentFieldId = decoded.fieldId;
            this.currentState = "DSBL";
            this._whenMatchInfoChanged();
        }
        else if (decoded.id == 3){ // match paused
            this.matchRunning = false;
            this.currentFieldId = decoded.fieldId;
            this.currentState = "PAUSED";
            this._whenMatchInfoChanged();
        }
        else if (decoded.id == 6){ // time updated
            // this.currentState = "RUNNING";
            this.currentMatchTime = decoded.remaining;
            this._whenMatchInfoChanged();
        }
        else if (decoded.id == 13){ // field list
            this.fieldList = {0: "N/A", ...decoded.fields}
        }
        else if (decoded.id == 14){ // FIELD_ACTIVATED
            this.currentFieldId = decoded.fieldId;
            this._whenMatchInfoChanged();
        }

        // don't have a message type yet for when the audience display is changed :(
        // else if (message.type == "displayUpdated"){// screen showing on audience display changed
        //     this.currentDisplay = message.display;
        //     this._whenDisplaySelected();
        // }
    }

    /**
     * Connect to the websocket
     */
    async init(){
        this.log("Initializing connection to TM server...");
        await this._connectWebsocket(true);
    }

    /**
     * Close the websocket connection
     */
    async close(){
        this.log("Closing connection to TM server...");
        if (this.websocket){
            this.websocket.close(1000);
        }
    }

    /**
     * Send a message to the TM server
     * @param {Buffer} data - data to send
     */
    async _send(data){
        await this._connectWebsocket();
        this.websocket.send(data);
    }

    /**
     * Send a "FieldSetRequest" message to TM
     * @param {Object} msg - Object representing a valid "FieldSetRequest" message
     */
    _sendFSRequest(msg){
        let buffer = this.fs_request.encode(msg).finish();
        console.log(buffer);
        let mangled = this._mangle(buffer);
        this._send(mangled);
    }

    /**
     * Construct and send a "FieldControlRequest" with the specified value
     * @param {Number} value - value to send. Meanings are:
     * 0 - none (presumably this does nothing)
     * 1 - start match
     * 2 - end early
     * 3 - abort
     * 4 - reset timer
     */
    _sendFCRequest(value){
        let msg = {
            fieldControl: {
                id: value,
                fieldId: this.currentFieldId
            }
        };

        this._sendFSRequest(msg);
    }

    /**
     * 
     * @param {Number} type - Type of match to queue (1 for next match, 2 for driving skills, 3 for programming skills)
     */
    _queueMatch(type){
        let msg = {
            queueMatch: type
        };
        this._sendFSRequest(msg);
    }

    /**
     * Send a "SetActiveFieldRequest" message, i.e., (re)assign the currently-queued match to a particular field
     * @param {Number} id - ID of field to set as active
     */
    _setActiveFieldRequest(id){
        let msg = {
            setActive: {
                fieldId: id
            }
        };
        this._sendFSRequest(msg);
    }
    
    /**
     * Move the currently-queued match to the specified field.
     * (this is the same as _setActiveFieldRequest but with a name that makes more sense in the context of using this class)
     * @param {Number} id - ID of field to move match to
     */
    moveMatchToField(id){
        this._setActiveFieldRequest(id);
        this.currentFieldId = id;
    }


    /**
     * Start the currently-queued match
     */
    async start(){
        if (!this.matchRunning){
            this._sendFCRequest(1);
        }
    }

    /**
     * End the match early
     */
    async endEarly(){
        if (this.matchRunning){
            this._sendFCRequest(2);
        }    
    }

    /**
     * Start the currently-queued match, or end early if a match is running
     */
    async startOrEnd(){
        if (this.matchRunning){
            await this.endEarly();
        }
        else{
            await this.start();
        }
    }

    /**
     * Queue the next match
     */
    async queueNextMatch(){
        this._queueMatch(1);
    }

    /**
     * Queue the previous match
     */
    async queuePrevMatch(){
        // can't do this with the new protobuf interface yet :(
    }

    /**
     * Queue driving skills
     * @param {Int} fieldId – ID of the field to queue the skills match on
     */
    async queueDrivingSkills(fieldId){
        this._queueMatch(2);
        this.currentFieldId = parseInt(fieldId);
        this._setActiveFieldRequest(fieldId);
    }

    /**
     * Queue programming skills
     * @param {Int} fieldId – ID of the field to queue the skills match on
     */
    async queueProgrammingSkills(fieldId){
        this._queueMatch(3);
        this.currentFieldId = parseInt(fieldId);
        this._setActiveFieldRequest(fieldId);
    }

    /**
     * Reset match timer
     */
    async resetTimer(){
        this._sendFCRequest(4);
    }

    /**
     * Select a particular display
     * @param {*} d number of the display to select
     */
    async selectDisplay(d){
        // can't do this with the new protobuf interface yet :(
    }

    /**
     * Specify a function to be called any time the match info (number, state, or time remaining) changes.
     * @param {Function} callback – callback to execute
     */
    onMatchInfoChange(callback){
        this.onMatchInfoChangeCallback = callback;
    }

    /**
     * Helper function to call the onMatchInfoChange callback
     */
    _whenMatchInfoChanged(){
        this.onMatchInfoChangeCallback({
            "match": this.currentMatch,
            "state": this.currentState,
            "time" : this.currentMatchTime,
            "isRunning": this.matchRunning,
            "field": this.fieldList[this.currentFieldId]
        });
    }

    /**
     * Specify a function to be called any time the audience display content is changed
     * @param {Function} callback - callback to execute
     */
    onDisplaySelected(callback){
        this.onDisplaySelectedCallback = callback;
    }

    /**
     * Helper function to call the onDisplaySelected callback
     */
    _whenDisplaySelected(){
        if (this.onDisplaySelectedCallback != null){
            this.onDisplaySelectedCallback(this.currentDisplay);
        }
    }

    /**
     * Specify a function to be called when the connection to TM ends.
     * @param {Function} callback 
     */
    onClose(callback){
        this.onCloseCallback = callback;
    }

    /**
     * Provide the list of fields
     * @returns {Object} IDs and names of fields in this set
     */
    getFields(){
        return this.fieldList;
    }
}