let Activator = require('./lib/activator.js').default;
let vscode = require('vscode');
let view = null;

async function activate(context) {
  if (checkSerialPort()) {
    let activator = new Activator();
    view = await activator.activate(context);
  }
}

function deactivate() {
  if (view != undefined)
    view.destroy();
}

function checkSerialPort() {
  try {
    require('serialport');
    return true;
  }
  catch (e) {
    console.log('Error while loading serialport library');
    console.log(e);

    if (e.message.includes('NODE_MODULE_VERSION')) {
      if (vscode.env.appName.includes('Insider')) {
        vscode.window.showErrorMessage(
          'This version of Pico-Go is incompatible with VSCode Insiders ' +
          vscode.version +
          ". Check for an update to the extension. If one isn't available, don't worry, it will be available soon. There's no need to raise a GitHub issue."
          );
      }
      else {
        vscode.window.showErrorMessage(
          'This version of Pico-Go is incompatible with VSCode ' + vscode
          .version +
          ". Check for an update to the extension. If one isn't available, raise a bug at https://github.com/cpwood/Pico-Go to get this fixed!"
          );
      }
    }
    else if (e.message.includes('.vscode-server')) {
      vscode.window.showErrorMessage(
        "Pico-Go is not currently compatible with the 'VSCode Remote - SSH' extension."
        );
    }
    else {
      vscode.window.showErrorMessage(
        'There was a problem loading the serialport bindings. Pico-Go will not work.'
        );
    }

    return false;
  }
}

exports.activate = activate;
exports.deactivate = deactivate;