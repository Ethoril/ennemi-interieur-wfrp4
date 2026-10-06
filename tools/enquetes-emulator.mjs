import { mkdtemp,writeFile,rm,readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
if(process.env.GOOGLE_APPLICATION_CREDENTIALS||process.env.GOOGLE_CLOUD_QUOTA_PROJECT||process.env.GCLOUD_PROJECT==='campagne-wrpg'||process.env.FIREBASE_PROJECT==='campagne-wrpg')throw new Error('Tests refusés avec des identifiants ou une cible de production');
const temp=await mkdtemp(join(tmpdir(),'enquetes-tests-'));
try {
  const localJavas=await readdir(join(root,'tools/.runtime/java21')).catch(()=>[]);
  const javaHome=process.env.JAVA_HOME|| (localJavas[0]?join(root,'tools/.runtime/java21',localJavas[0]):null);
  const config=join(temp,'firebase.json');
  await writeFile(config,JSON.stringify({firestore:{rules:join(root,'firestore.rules')},storage:{rules:join(root,'storage.rules')},
    emulators:{firestore:{port:8123},storage:{port:9223},hub:{port:4523},logging:{port:4623},ui:{enabled:false}}}));
  const env={...process.env,XDG_CONFIG_HOME:temp,CI:'1',FIREBASE_EMULATORS_PATH:join(root,'tools/.runtime/emulators'),...(javaHome?{JAVA_HOME:javaHome,PATH:join(javaHome,'bin')+';'+process.env.PATH}:{})};
  const result=spawnSync(process.execPath,[join(root,'node_modules/firebase-tools/lib/bin/firebase.js'),'emulators:exec','--only','firestore,storage','--project','demo-enquetes','--config',config,
    `node --test "${join(root,'tools/enquetes-*.test.mjs')}"`],{cwd:root,env,stdio:'inherit'});
  if(result.error)throw result.error;process.exitCode=result.status??1;
}finally{await rm(temp,{recursive:true,force:true});}


