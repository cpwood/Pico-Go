'use babel';
import * as fs from 'fs';
import { promises as fsp } from 'fs';
import * as crypto from 'crypto';
import Logger from '../helpers/logger.js';
import Utils from '../helpers/utils.js';

export default class ProjectStatus {

  constructor(shell,settings,local_folder){
    this.shell = shell;
    this.logger = new Logger('ProjectStatus');
    this.utils = new Utils(settings);
    this.localFolder = local_folder;
    this.settings = settings;
    this.allowedFileTypes = this.settings.getAllowedFileTypes();
    this.content = [];
    this.boardFileHashes = {};
    this.localFileHashes = this.__get_local_files_hashed();
    this.changed = false;
  }

  read(cb){
    let _this = this;
    this.shell.readFile('project.pymakr',function(err,content_buffs,content_str){
      if(err){
        cb(err);
        return;
      }

      let json_content = [];
      if(content_str != ''){
        try{
          json_content = JSON.parse(content_str);
          err = false;
        } catch(e){
          _this.logger.error(e);
          err = true;
        }
      }
      _this.content = json_content;
      _this.__process_file();
      cb(err,json_content);
    });
  }

  async readAsync(){
    let _this = this;
    this.shell.readFile('project.pymakr',function(err,content_buffs,content_str){
      if(err){
        cb(err);
        return;
      }

      let json_content = [];
      if(content_str != ''){
        try{
          json_content = JSON.parse(content_str);
          err = false;
        } catch(e){
          _this.logger.error(e);
          err = true;
        }
      }
      _this.content = json_content;
      _this.__process_file();
      cb(err,json_content);
    });
  }

  write_all(cb){
    this.boardFileHashes = this.localFileHashes;
    this.write(cb);
  }

  write(cb){
    let _this = this;
    if(this.changed){
      this.logger.info('Writing project status file to board');
      let board_hash_array = Object.values(this.boardFileHashes);
      let project_file_content = Buffer.from(JSON.stringify(board_hash_array));
      this.shell.writeFile('project.pymakr',null,project_file_content,true,false,function(err){
        _this.changed = false;
        cb(err);
      },10); // last param prevents any retries
    }else{
      this.logger.info('No changes to file, not writing');
      cb();
    }
  }

  update(name){
    this.changed = true;
    if(!this.localFileHashes[name]){
      delete this.boardFileHashes[name];
    }else{
      this.boardFileHashes[name] = this.localFileHashes[name];
    }
  }

  remove(filename){
    delete this.boardFileHashes[filename];
  }

  __process_file(){
    for(let i=0;i<this.content.length;i++){
      let h = this.content[i];
      this.boardFileHashes[h[0]] = h;
    }
  }

  __get_local_files(dir){
    return fs.readdirSync(dir);
  }

  __get_local_files_hashed(files,path){
    if(!files){
      try{
        files = this.__get_local_files(this.localFolder);
      }catch(e){
        this.logger.error("Couldn't locate file folder");
        return false;
      }
    }
    if(!path){
      path = '';
    }
    let file_hashes = {};

    files = this.utils.ignoreFilter(files);

    for(let i=0;i<files.length;i++){
      let filename = path + files[i];
      if(filename.length > 0 && filename.substring(0,1) != '.'){
        let file_path = this.localFolder + filename;
        let stats = fs.lstatSync(file_path);
        let is_dir = stats.isDirectory();
        if(stats.isSymbolicLink()){
          is_dir = filename.indexOf('.') == -1;
        }
        if(is_dir){
          try {
            let files_from_folder = this.__get_local_files(file_path);
            if(files_from_folder.length > 0){
              let hash = crypto.createHash('sha256').update(filename).digest('hex');
              file_hashes[filename] = [filename,'d',hash];
              let hashes_in_folder = this.__get_local_files_hashed(files_from_folder,filename+'/');
              file_hashes = Object.assign(file_hashes,hashes_in_folder);
            }
          }catch(e){
           this.logger.info('Unable to read from dir '+file_path);
           console.log(e); 
          }
        }else{
          this.total_file_size += stats.size;
          this.total_number_of_files += 1;
          let contents = fs.readFileSync(file_path);
          let hash = crypto.createHash('sha256').update(contents).digest('hex');
          file_hashes[filename] = [filename,'f',hash,stats.size];
        }
      }
    }
    return file_hashes;
  }

  prepare_file(py_folder, file_path){
    let contents = fs.readFileSync(file_path);
    let stats = fs.lstatSync(file_path);
    let hash = crypto.createHash('sha256').update(contents).digest('hex');
    let filename = file_path.replace(py_folder, '');
    return [filename,'f',hash,stats.size];
  }

  get_changes(){
    let changed_files = [];
    let changed_folders = [];
    let deletes = [];
    let board_hashes = Object.assign({}, this.boardFileHashes);
    let local_hashes = Object.assign({}, this.localFileHashes);

    // all local files
    for(let name in local_hashes){
      let local_hash = this.localFileHashes[name];
      let board_hash = board_hashes[name];

      if(board_hash){
        // check if hash is the same
        if (local_hash[2] != board_hash[2]){

          if(local_hash[1] == 'f'){
            changed_files.push(local_hash);
          }else{
            changed_folders.push(local_hash);
          }
        }
        delete board_hashes[name];

      }else{
        if(local_hash[1] == 'f'){
          changed_files.push(local_hash);
        }else{
          changed_folders.push(local_hash);
        }
      }
    }
    for(let name in board_hashes){
      if(board_hashes[name][1] == 'f'){
        deletes.unshift(board_hashes[name]);
      }else{
        deletes.push(board_hashes[name]);
      }

    }
    return {'delete': deletes, 'files': changed_files,'folders': changed_folders};
  }


}
