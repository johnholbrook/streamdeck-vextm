# streamdeck-vextm
 [Stream Deck](https://www.elgato.com/en/welcome-to-stream-deck) plugin for controlling [VEX Tournament Manager](https://vextm.dwabtech.com/) using the [official API](https://kb.roboticseducation.org/hc/en-us/articles/19238156122135-TM-Public-API).
 
 ![image](https://user-images.githubusercontent.com/3682581/147676915-527bb66d-098a-4cb9-ad26-e0d1a23aeb94.png)


### Features
* Start and stop matches
* Queue next or previous match
* Queue driving & programming skills matches
* Control the audience display
* Reset timer

### Current Limitations
* The entire plugin can only be connected to one TM server and field set at a time. This means it is not possible to have different keys on the same stream deck, or even on different stream decks connected to the same computer, that control different field sets.
* The "Field Set ID" (and "Field ID" to queue skills matches) must be manually determined by the user. As a general rule, both start at 1 and count up from there. Field IDs are unique across the entire tournament.

### Configuring the Plugin
* Install the plugin from the [Elgato Marketplace](https://marketplace.elgato.com/product/vex-tournament-manager-9f059968-d499-4c2b-9bf2-b2c2817cb4cd) or download the latest version from the [releases page](https://github.com/johnholbrook/streamdeck-vextm/releases).
* Turn on the 3rd Party API in TM
  * In the *Tools* menu, choose *Options*
  * Under the *Web Publishing* category, tick the box for *Enable Local TM API*
  * Be sure to copy the *API Key* from this screen as you'll need it below
* Add the API Key to the Plugin
  *  Add one of the Plugin buttons to a Stream Deck profile
  *  Click on one of the newly added buttons to configure the plugin
  *  Under *Connection Settings*, set the *API Key* using the value obtained from TM above
* To configure a button to change the audience display
  *  Add the *Select Display* button to a Stream Deck profile and click on it to configure it
  *  Under *Field Set ID*, set the field you want to control
  *  Under *Display*, select the display function you want associated with this button (e.g. *Intro*, *Saved Match Results*, etc)
