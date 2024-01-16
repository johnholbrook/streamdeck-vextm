@REM build the node script that talks to TM and responds to keypresses
cd .\plugin_node
call npm install
call npm run build
cd ..

@REM package the .sdPlugin folder into a .streamDeckPlugin file for distribution
@REM https://developer.elgato.com/documentation/stream-deck/sdk/exporting-your-plugin/
mkdir dist
del .\dist\us.johnholbrook.vextm.streamDeckPlugin
DistributionTool.exe -b -i us.johnholbrook.vextm.sdPlugin -o .\dist