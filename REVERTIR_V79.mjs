#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const backup=path.join(root,"_respaldo_antes_v79");

for(const name of ["app.js","index.html"]){
  const source=path.join(backup,name);
  if(!fs.existsSync(source)){
    console.error(`No existe ${source}`);
    process.exit(1);
  }
}

fs.copyFileSync(path.join(backup,"app.js"),path.join(root,"app.js"));
fs.copyFileSync(path.join(backup,"index.html"),path.join(root,"index.html"));

console.log("✅ app.js e index.html fueron restaurados desde _respaldo_antes_v79/");
