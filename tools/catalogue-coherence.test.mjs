import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { createTalentResolver } from '../js/catalogue/talent-resolver.js';
import { createSkillResolver } from '../js/catalogue/skill-resolver.js';
import { canonicalSkillNom } from '../js/fiche/skill-names.js';
const read = p => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const catalogue=read('js/catalogue/referentiel-public.json'), snapshot=read('js/catalogue/talents-sheet-snapshot.json');
const talents=createTalentResolver({...catalogue.talents,sheetSnapshot:snapshot});
const skills=createSkillResolver(catalogue.skills);
test('les trois anciens libellés correspondent aux talents existants et préservent le choix de Vent',()=>{
 for(const [name,english] of [["Béni d'Isha",'Blessed by Isha'],['Maniement de 2 armes','Dual Wielder'],['Imprégné par le (Vent)','Suffuse With'],['Imprégné par le (Aqshy)','Suffuse With']]) {
  const x=talents.resolve(name); assert.equal(x.status,'resolved',name);assert.equal(x.entry.englishName,english,name);
 }
 assert.equal(talents.resolve('Imprégné par le (Vent)').open,true);
 assert.equal(talents.resolve('Imprégné par le (Aqshy)').specialization,'Aqshy');
 assert.equal(talents.resolve('Imprégné de Magie (Suffused with Magic)').sourceRule,undefined);
});
test('les deux noms sans source et cinq traits ne sont pas achetables comme talents',()=>{
 for(const name of ['Bon sens','Vivant','Compagnon','Invisibilité','Messager','Partage sensoriel','Télépathie animale']){
  assert.equal(catalogue.talents.entries.some(x=>x.nom===name),false,name);
  assert.equal(talents.purchaseStatus({talentsAcq:[]},name).allowed,false,name);
 }
});
test('les six valeurs et résolutions de compétences suivent les groupes du livre V5',()=>{
 for(const [label,carac,basic] of [["Corps à corps (Arme d'hast)",'cc',false],['Métier (Calligraphe)','dex',false],['Métier (Cartographe)','dex',false],['Métier (Graveur)','dex',false],['Représentation (Acteur)','soc',true]]) {
  let x=skills.resolve(label);assert.equal(x.status,'resolved',label);assert.equal(x.entry.carac,carac,label);assert.equal(x.entry.basic,basic,label);
 }
 for(const name of ['Métier (Calligraphe)','Métier (Cartographe)','Métier (Graveur)']) assert.equal(canonicalSkillNom(name),name);
 assert.equal(skills.resolve('Art (Gravure)').entry.basic,true);
 assert.equal(skills.resolve('Divertissement (Acteur)').entry.carac,'soc');
});
