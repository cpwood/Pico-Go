'use babel';

import { promises as fsp } from 'fs';
import path from 'path';
import fse from 'fs-extra';
import _ from 'lodash';
import * as vscode from 'vscode';
import Utils from '../helpers/utils.js';
import ApiWrapper from '../main/api-wrapper.js';

export default class StubsManager {
    async updateStubs() {
        let configFolder = Utils.getConfigPath();
        let existingVersionFile = path.join(configFolder, 'Pico-Stub', 'version.json');
        let thisVersionFile = path.resolve(path.join(__dirname, '..', '..', 'stubs', 'version.json'));
        let thisVersion = JSON.parse(await fsp.readFile(thisVersionFile, 'utf-8'));

        if (await Utils.exists(existingVersionFile)) {
            let existingVersion = JSON.parse(await fsp.readFile(existingVersionFile, 'utf-8'));

            if (thisVersion.version == existingVersion.version)
                return;         
        }

        try {
            await fse.emptyDir(path.join(configFolder, 'Pico-Stub')); 
            await fse.copy(path.resolve(path.join(__dirname, '..', '..', 'stubs')), path.resolve(path.join(configFolder, 'Pico-Stub')));
        }
        catch(err) {
            console.log(err);
        }      
    }

    async addToWorkspace() {
        let api = new ApiWrapper();
        let workspace = api.getProjectPath();
        let vsc = path.join(workspace, '.vscode');

        if (!await Utils.exists(vsc)) {
            await fsp.mkdir(vsc);
        }

        await this._addStubs(vsc);
        await this._addExtensions(vsc);
        await this._addSettings(vsc);

        vscode.window.showInformationMessage('Project configuration complete!');
        vscode.commands.executeCommand('workbench.extensions.action.showRecommendedExtensions');
    }

    async _addStubs(vsc) {
        if (!await Utils.exists(path.join(vsc, 'Pico-Stub'))) {
            let configFolder = Utils.getConfigPath();
            await fsp.symlink(path.resolve(path.join(configFolder, 'Pico-Stub')), path.resolve(path.join(vsc, 'Pico-Stub')), 'junction');
        }
    }

    async _addExtensions(vsc) {
        let extensions = {};

        if (await Utils.exists(path.join(vsc, 'extensions.json'))) {
            extensions = JSON.parse(await fsp.readFile(path.join(vsc, 'extensions.json')));
        }

        if (extensions.recommendations === undefined) {
            extensions.recommendations = [];
        }

        if (!_.includes(extensions.recommendations, 'ms-python.python'))
            extensions.recommendations.push('ms-python.python');

        if (!_.includes(extensions.recommendations, 'visualstudioexptteam.vscodeintellicode'))
            extensions.recommendations.push('visualstudioexptteam.vscodeintellicode');

        if (!_.includes(extensions.recommendations, 'ms-python.vscode-pylance'))
            extensions.recommendations.push('ms-python.vscode-pylance');

        await fsp.writeFile(path.join(vsc, 'extensions.json'), JSON.stringify(extensions, null, 4));
    }

    async _addSettings(vsc) {
        let settings = {};

        if (await Utils.exists(path.join(vsc, 'settings.json'))) {
            settings = JSON.parse(await fsp.readFile(path.join(vsc, 'settings.json')));
        }

        settings['python.linting.enabled'] = true;

        if (settings['python.analysis.typeshedPaths'] === undefined) {
            settings['python.analysis.typeshedPaths'] = [];
        }

        if (!_.includes(settings['python.analysis.typeshedPaths'], path.join('.vscode', 'Pico-Stub')))
            settings['python.analysis.typeshedPaths'].push(path.join('.vscode', 'Pico-Stub'));

        settings['python.languageServer'] = 'Pylance';
        settings['python.analysis.typeCheckingMode'] = 'basic';

        if (settings['python.analysis.extraPaths'] === undefined) {
            settings['python.analysis.extraPaths'] = [];
        }

        if (!_.includes(settings['python.analysis.extraPaths'], path.join('.vscode', 'Pico-Stub', 'stubs')))
            settings['python.analysis.extraPaths'].push(path.join('.vscode', 'Pico-Stub', 'stubs'));

        await fsp.writeFile(path.join(vsc, 'settings.json'), JSON.stringify(settings, null, 4));
    }
}