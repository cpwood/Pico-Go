let vscode = require('vscode');
let exec = require('child_process').exec;
let PanelView, Pymakr, Pyboard,SettingsWrapper, pb,v,sw,pymakr;
let os = require('os');
let pkg = require('./package.json');
let _ = require('lodash');
let path = require('path');

function activate(context) {

    prepareSerialPort(function(error){
        if(error){
            let err_mess = 'There was an error with your serialport module, Pico-Go will likely not work properly. Please try to install again or report an issue on GitHub.';
            vscode.window.showErrorMessage(err_mess);
            console.log(err_mess);
            console.log(error);
        }

        SettingsWrapper = require('./lib/main/settings-wrapper').default;

        sw = new SettingsWrapper();
        sw.initialize().then(function(){
            
            checkNodeVersion(function(nodejs_installed){
                if(!nodejs_installed){
                    vscode.window.showErrorMessage('NodeJS not detected on this machine, which is required for Pico-Go to work.');
                }else{
                    PanelView = require('./lib/main/panel-view').default;
                    Pymakr = require('./lib/pymakr').default;
                    Pyboard = require('./lib/board/pyboard').default;
                    StubsManager = require('./lib/stubs/stubs-manager').default;

                    let sm = new StubsManager();
                    sm.updateStubs();
                    
                    pb = new Pyboard(sw);
                    v = new PanelView(pb,sw);
                    pymakr = new Pymakr({},pb,v,sw);
                                
                    
                    let terminal = v.terminal;
                
                    let disposable = vscode.commands.registerCommand('pymakr.help', function () {
                        terminal.show();
                        vscode.env.openExternal(vscode.Uri.parse('http://pico-go.net/docs/start/quick/'));
                    });
                    context.subscriptions.push(disposable);
                    
                    disposable = vscode.commands.registerCommand('pymakr.listCommands', function () {
                        v.showQuickPick();
                    });
                    context.subscriptions.push(disposable);
                
                    disposable = vscode.commands.registerCommand('pymakr.initialise', function () {
                        sm.addToWorkspace();
                    });
                    context.subscriptions.push(disposable);
                    
                    disposable = vscode.commands.registerCommand('pymakr.connect', function () {
                        terminal.show();
                        pymakr.connect();
                    });
                    context.subscriptions.push(disposable);
                
                    disposable = vscode.commands.registerCommand('pymakr.run', async function () {
                        terminal.show();
                        await pymakr.runAsync();
                    });
                    context.subscriptions.push(disposable);
                
                    disposable = vscode.commands.registerCommand('pymakr.runselection', async function () {
                        terminal.show();
                        await pymakr.runSelectionAsync();
                    });
                    context.subscriptions.push(disposable);

                    disposable = vscode.commands.registerCommand('pymakr.upload', function () {
                        terminal.show();
                        pymakr.upload();
                    });
                    context.subscriptions.push(disposable);
                
                    disposable = vscode.commands.registerCommand('pymakr.uploadFile', function () {
                        terminal.show();
                        pymakr.uploadFile();
                    });
                    context.subscriptions.push(disposable);
                
                    disposable = vscode.commands.registerCommand('pymakr.download', async function () {
                        terminal.show();
                        await pymakr.downloadAsync();
                    });
                    context.subscriptions.push(disposable);

                    disposable = vscode.commands.registerCommand('pymakr.deleteAllFiles', function () {
                        terminal.show();

                    setTimeout(async function() {
                        await pymakr.deleteAllFilesAsync();
                        }, 500);  
                    });
                    context.subscriptions.push(disposable);
                
                    disposable = vscode.commands.registerCommand('pymakr.globalSettings', async function () {
                        await pymakr.openGlobalSettingsAsync();
                    });
                    context.subscriptions.push(disposable);
                
                    disposable = vscode.commands.registerCommand('pymakr.projectSettings', async function () {
                        await pymakr.openProjectSettingsAsync();
                    });
                    context.subscriptions.push(disposable);
                
                    disposable = vscode.commands.registerCommand('pymakr.disconnect', function () {
                        pymakr.disconnect();
                    });
                    context.subscriptions.push(disposable);
                
                    // // not used. open/close terminal command is already available. 
                    // // Terminal opens automatically when doing a connect, run or sync action.
                    // disposable = vscode.commands.registerCommand('pymakr.toggleREPL', function () {
                    //     pymakr.toggleVisibility()
                    // });
                    // context.subscriptions.push(disposable);
                
                    disposable = vscode.commands.registerCommand('pymakr.toggleConnect', async function () {
                        if(!pymakr.board.connected){
                            terminal.show();
                        }
                        await pymakr.toggleConnectAsync();
                    });
                    context.subscriptions.push(disposable);
                
                
                    disposable = vscode.commands.registerCommand('pymakr.extra.pins', function () {
                        const panel = vscode.window.createWebviewPanel(
                            'pins',
                            'Pico Pin Map',
                            vscode.ViewColumn.One,
                            {
                              // Only allow the webview to access resources in our extension's media directory
                              localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'images'))]
                            }
                          );
                    
                          const onDiskPath = vscode.Uri.file(
                            path.join(context.extensionPath, 'images', 'Pico-Pins.png')
                          );
                          const imageUrl = panel.webview.asWebviewUri(onDiskPath);
                    
                          panel.webview.html = getPinMapHtml(imageUrl);
                    });
                    context.subscriptions.push(disposable);

                    disposable = vscode.commands.registerCommand('pymakr.extra.getFullVersion', async function () {
                        terminal.show();
                        await pymakr.getFullVersionAsync();
                    });
                    context.subscriptions.push(disposable);
                
                    // disposable = vscode.commands.registerCommand('pymakr.extra.getWifiMac', function () {
                    //     terminal.show()
                    //     pymakr.getWifiMac()
                    // });
                    // context.subscriptions.push(disposable);
                
                    disposable = vscode.commands.registerCommand('pymakr.extra.getSerial', async function () {
                        terminal.show();
                        await pymakr.getSerialAsync();
                    });
                    context.subscriptions.push(disposable);

                    disposable = vscode.commands.registerCommand('pymakr.reset.soft', async function () {
                        terminal.show();
                        await pymakr.resetSoftAsync();
                    });
                    context.subscriptions.push(disposable);
                    
                    disposable = vscode.commands.registerCommand('pymakr.reset.hard', async function () {
                        terminal.show();
                        await pymakr.resetHardAsync();
                    });
                    context.subscriptions.push(disposable);
                }
            });
        });
    });
}


exports.activate = activate;

function deactivate() {
    v.destroy();
}

function getOsName() {
    switch (os.platform()) {
        case 'win32':
            return 'Windows';
        case 'linux':
            return 'Linux';
        case 'darwin':
            return 'macOS';
        case 'aix':
            return 'IBM AIX';
        case 'freebsd':
            return 'FreeBSD';
        case 'openbsd':
            return 'OpenBSD';
        case 'sunos':
            return 'SunOS';
    }
} 

function prepareSerialPort(cb){
    
    try {
        let isCompatible = false;
        let item = _.find(pkg.compatibility, x => x.platform == os.platform());

        if (item != null) {
            isCompatible = _.includes(item.arch, os.arch());
        }

        if (!isCompatible) {
            vscode.window.showErrorMessage(`Sorry, Pico-Go isn't compatible with ${getOsName()} (${os.arch()}).`);
            return;
        }

        require('serialport');
        cb();
    }catch(e){
        console.log('Error while loading serialport library');
        console.log(e);

        if (e.message.includes('NODE_MODULE_VERSION')) {
            if (vscode.env.appName.includes('Insider')) {
                vscode.window.showErrorMessage('This version of Pico-Go is incompatible with VSCode Insiders ' + vscode.version
                + ". Check for an update to the extension. If one isn't available, don't worry, it will be available soon. There's no need to raise a GitHub issue.");
            }
            else {
                vscode.window.showErrorMessage('This version of Pico-Go is incompatible with VSCode ' + vscode.version
                + ". Check for an update to the extension. If one isn't available, raise a bug at https://github.com/cpwood/Pico-Go to get this fixed!");
            }
        }
        else if (e.message.includes('.vscode-server')) {
            vscode.window.showErrorMessage("Pico-Go is not currently compatible with the 'VSCode Remote - SSH' extension.");
        }
        else {
            vscode.window.showErrorMessage('There was a problem loading the serialport bindings. Pico-Go will not work.');
        }
    }
}

function checkNodeVersion(cb){
    exec('node -v',function(err,stdout,stderr){
        cb(stdout.substr(0,1) == 'v');
    });
}

function getPinMapHtml(imageUrl) {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Pico Pin Map</title>
        <style type="text/css">
            body {
                background-color: #191c2b;
            }
        </style>
    </head>
    <body>
        <img src="${imageUrl}" />
    </body>
    </html>`;
}

exports.deactivate = deactivate;