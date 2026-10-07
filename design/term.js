const C={text:"#dee0e1",muted:"#9da5a9",dim:"#7e888e",accent:"#a798d7",success:"#68b78d",warning:"#cd9a22",error:"#ea7f81",
  mdLink:"#69add0",syntaxString:"#de8d5a",track:"#484e52",bg:"#18191e"};
const THINK={off:"#6c767b",minimal:"#68808d",low:"#5489a4",medium:"#6185cc",high:"#9776e5",xhigh:"#de54c1",max:"#fe5462"};
const hex2rgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255);
const lin=c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4, gam=c=>c<=.0031308?12.92*c:1.055*c**(1/2.4)-.055;
function toLab([r,g,b]){r=lin(r);g=lin(g);b=lin(b);
  const l=Math.cbrt(.4122214708*r+.5363325363*g+.0514459929*b),m=Math.cbrt(.2119034982*r+.6806995451*g+.1073969566*b),s=Math.cbrt(.0883024619*r+.2817188376*g+.6299787005*b);
  return[.2104542553*l+.793617785*m-.0040720468*s,1.9779984951*l-2.428592205*m+.4505937099*s,.0259040371*l+.7827717662*m-.808675766*s];}
function fromLab([L,a,b]){const l=(L+.3963377774*a+.2158037573*b)**3,m=(L-.1055613458*a-.0638541728*b)**3,s=(L-.0894841775*a-1.291485548*b)**3;
  return[4.0767416621*l-3.3077115913*m+.2309699292*s,-1.2684380046*l+2.6097574011*m-.3413193965*s,-.0041960863*l-.7034186147*m+1.707614701*s].map(c=>Math.round(Math.min(1,Math.max(0,gam(c)))*255));}
const mix=(h1,h2,t)=>{const A=toLab(hex2rgb(h1)),B=toLab(hex2rgb(h2));const[r,g,b]=fromLab(A.map((v,i)=>v+(B[i]-v)*t));return"#"+[r,g,b].map(x=>x.toString(16).padStart(2,"0")).join("");};
const STOPS=[[0,C.mdLink],[.45,C.success],[.72,C.warning],[.9,C.error],[1,C.error]];
function heat(x){for(let i=1;i<STOPS.length;i++){const[a,ca]=STOPS[i-1],[b,cb]=STOPS[i];if(x<=b)return mix(ca,cb,(x-a)/(b-a||1));}return C.error;}

const T=(t,c)=>({t,c});
const width=s=>s.reduce((n,g)=>n+(g.cell?1:[...g.t].length),0);
const esc=s=>s.replace(/&/g,"&amp;").replace(/</g,"&lt;");
const BOX={"─":"h","━":"H","╍":"D","│":"v","╭":"tl","╮":"tr","╰":"bl","╯":"br"};
function html(segs,W){let s="";for(const g of segs){
  if(g.cell){s+=`<i class="c" style="background:${g.solid?g.c:`linear-gradient(90deg,${g.c} 0 62.5%,transparent 62.5%)`}"></i>`;continue;}
  let buf="";const flush=()=>{if(buf)s+=`<span${g.c?` style="color:${g.c}"`:""}>${esc(buf)}</span>`;buf="";};
  for(const ch of g.t){if(BOX[ch]){flush();s+=`<i class="g ${BOX[ch]}" style="--k:${g.c||C.text}"></i>`;}else buf+=ch;}
  flush();}
  return`<div class="ln" style="width:calc(${W}ch + 28px)">${s}</div>`;}
const alertOf=p=>p==null?null:p>=90?"error":p>=70?"warning":null;
function sides(W,bc,inner){const pad=W-2-width(inner);return[T("│",bc),...inner,T(" ".repeat(Math.max(0,pad))),T("│",bc)];}
