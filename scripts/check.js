import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const folders=['src','scripts','public','tests'];
const files=[];
async function walk(folder){for(const entry of await fs.readdir(folder,{withFileTypes:true})){const full=path.join(folder,entry.name);if(entry.isDirectory())await walk(full);else if(entry.name.endsWith('.js'))files.push(full);}}
for(const folder of folders)await walk(path.join(root,folder));
for(const file of files){const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(result.status!==0){process.stderr.write(result.stderr);process.exit(1);}}
const required=['migrations/001_init.sql','public/index.html','public/widget/index.html','.env.example','Dockerfile'];
for(const file of required){try{await fs.access(path.join(root,file));}catch{throw new Error(`Missing required release file: ${file}`);}}
console.log(`Static release checks passed for ${files.length} JavaScript files.`);
