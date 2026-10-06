export class Element {
  constructor(d,tag){this.ownerDocument=d;this.tagName=tag;this.children=[];this.listeners=new Map();this.attributes={};this.className='';this.textContent='';this.value='';this.style={};this.selectionStart=0;this.selectionEnd=0;this.classList={add:value=>{this.className+=' '+value;}};}
  get firstChild(){return this.children[0];}get options(){return this.children;}get selectedOptions(){return this.options.filter(v=>v.selected);}
  append(...children){for(const c of children){c.remove?.();c.parentNode=this;this.children.push(c);}}
  prepend(...children){this.children.unshift(...children);for(const c of children)c.parentNode=this;}
  replaceChildren(...children){for(const c of this.children)c.parentNode=null;this.children=[];this.append(...children);}
  remove(){if(this.parentNode){this.parentNode.children=this.parentNode.children.filter(c=>c!==this);this.parentNode=null;}}
  setAttribute(k,v){this.attributes[k]=String(v);}getAttribute(k){return this.attributes[k]??null;}
  addEventListener(k,fn){if(!this.listeners.has(k))this.listeners.set(k,[]);this.listeners.get(k).push(fn);}
  removeEventListener(k,fn){this.listeners.set(k,(this.listeners.get(k)||[]).filter(v=>v!==fn));}
  contains(target){return this===target||this.children.some(c=>c.contains?.(target));}
  dispatch(type,properties={}){const event={target:this,currentTarget:this,preventDefault(){},...properties};let n=this;do{event.currentTarget=n;for(const fn of n.listeners?.get(type)||[])fn(event);n=n.parentNode;}while(n);}
  showModal(){this.open=true;this.querySelector('textarea,button,input')?.focus();}
  close(){this.open=false;this.dispatch('close');}
  click(){this.dispatch('click');}
  cloneNode(){const copy=new Element(this.ownerDocument,this.tagName);copy.src=this.src;copy.alt=this.alt;return copy;}
  focus(){this.ownerDocument.activeElement=this;}
  querySelectorAll(selector){const result=[],selectors=selector.split(',');const walk=n=>{for(const c of n.children||[]){if(selectors.some(s=>s.startsWith('.')?c.className?.split(' ').includes(s.slice(1)):c.tagName===s))result.push(c);walk(c);}};walk(this);return result;}
  querySelector(s){return this.querySelectorAll(s)[0]||null;}
  setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b;}
}
export function createDocument(){const d=new Element(null,'document');d.ownerDocument=d;d.activeElement=null;d.createElement=tag=>new Element(d,tag);d.createTextNode=text=>Object.assign(new Element(d,'text'),{textContent:text});return d;}
export const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
