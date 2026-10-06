
import { build } from 'esbuild';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { resolve,dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),check=process.argv.includes('--check'),packages=new Set();
await mkdir(join(root,'js/vendor'),{recursive:true});
for(const name of ['d3','zip']){
  const output=join(root,'js/vendor/enquetes-'+name+'.js');
  const result=await build({entryPoints:[join(root,'tools/lib/enquetes-'+name+'-entry.mjs')],outfile:output,bundle:true,format:'esm',platform:'browser',target:'es2020',minify:true,legalComments:'inline',write:false,metafile:true});
  for(const input of Object.keys(result.metafile.inputs)){
    const match=input.replaceAll('\\','/').match(/node_modules\/(?:@[^/]+\/)?[^/]+/u);if(match)packages.add(match[0]);
  }
  const text=result.outputFiles[0].text;
  if(check){if(await readFile(output,'utf8')!==text)throw new Error('Bundle V2 à régénérer : '+name);}
  else await writeFile(output,text,'utf8');
}
let licenses='Dependencies bundled for documents and investigations.\n\n';
for(const path of [...packages].sort()){
  const metadata=JSON.parse(await readFile(join(root,path,'package.json'),'utf8'));
  let license='';for(const file of ['LICENSE','LICENSE.md','LICENSE.markdown','LICENSE.txt']){try{license=await readFile(join(root,path,file),'utf8');break;}catch{/* next name */}}
  licenses+=metadata.name+' '+metadata.version+' ('+metadata.license+')\n'+license+'\n\n';
}
const path=join(root,'js/vendor/enquetes-LICENSES.txt');
if(check){if(await readFile(path,'utf8')!==licenses)throw new Error('Licences V2 à régénérer');}
else await writeFile(path,licenses,'utf8');
console.log(check?'Bundles V2 synchronisés':'Bundles V2 générés');

