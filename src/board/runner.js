'use babel';

import ApiWrapper from '../main/api-wrapper.js';

export default class Runner {
  constructor(pyboard, terminal, pymakr) {
    this.pyboard = pyboard;
    this.terminal = terminal;
    this.pymakr = pymakr;
    this.api = new ApiWrapper();
    this.busy = false;
  }

  async toggleAsync() {
    if (this.busy) {
      await this.stopAsync();
    }
    else {
      await this.startAsync();
    }
  }

  async startAsync() {
    let currentFile = this._getCurrentFile();

    if (currentFile == undefined)
      return;

    this.terminal.writeln('Running ' + currentFile.filename);
    this.busy = true;
    this.pymakr.view.setButtonState(this.busy);

    await this.pyboard.runAsync(currentFile.content);
    this.busy = false;
  }

  async selectionAsync(codeblock, hideMessage = false) {
    codeblock = this._trimcodeblock(codeblock);
    if (!hideMessage)
      this.terminal.writeln('Running selected lines');
    this.busy = true;

    try {
      await this.pyboard.runAsync(codeblock);
      this.busy = false;
    }
    catch(err) {
      this.terminal.writelnAndPrompt(err);
    }
  }

  async stopAsync() {
    if (this.busy) {
      await this.pyboard.stopRunningProgramsNoFollowAsync();
      await this.pyboard.flushAsync();
      await this.pyboard.enterFriendlyReplAsync();
      this.terminal.enter();
      this.terminal.write('>>> ');
      this.busy = false;
    }
  }

  _getCurrentFile() {
    let file = this.api.getOpenFile();

    if (!file.content) {
      return;
    }

    let filename = 'untitled file';
    if (file.path) {
      filename = file.path.split('/').pop(-1);
      let filetype = filename.split('.').pop(-1);
      if (filetype.toLowerCase() != 'py') {
        return;
      }
    }

    return {
      content: file.content,
      filename: filename
    };
  }

  //remove excessive identation
  _trimcodeblock(codeblock) {
    // regex to split both win and unix style
    let lines = codeblock.match(/[^\n]+(?:\r?\n|$)/g);
    // count leading spaces in line1 ( Only spaces, not TAB)
    let count = 0;
    if (lines) {
      while (lines[0].startsWith(' ', count)) {
        count++;
      }

      // remove from all lines
      if (count > 0) {
        let prefix = ' '.repeat(count);
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].startsWith(prefix)) {
            lines[i] = lines[i].slice(count);
          }
          else {
            // funky identation or selection; just trim spaces and add warning
            lines[i] = lines[i].trim() + ' # <- IndentationError';
          }
        }
      }
      // glue the lines back together
      return (lines.join(''));
    }
    return codeblock;
  }

}