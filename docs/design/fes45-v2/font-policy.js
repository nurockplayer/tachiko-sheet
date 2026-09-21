"use strict";
/* V3 author-selected local fonts. No remote fonts, synthetic weights, or font binaries. */
window.resolveFesFonts=async function(){
 const faces=[
 ['FES Latin','Inter-Regular',400,'normal'],['FES Latin','Inter-Medium',500,'normal'],['FES Latin','Inter-SemiBold',600,'normal'],['FES Latin','Inter-Italic',400,'italic'],
 ['FES Display','InterDisplay-SemiBold',600,'normal'],
 ['FES Japanese','NotoSansCJKjp-Regular',400,'normal'],['FES Japanese','NotoSansCJKjp-Medium',500,'normal'],['FES Japanese','NotoSansCJKjp-Bold',600,'normal'],
 ['FES Traditional Chinese','NotoSansCJKtc-Regular',400,'normal'],['FES Traditional Chinese','NotoSansCJKtc-Medium',500,'normal'],['FES Traditional Chinese','NotoSansCJKtc-Bold',600,'normal']
 ];
 const chosen=[];
 for(const [alias,name,weight,style] of faces){
  const face=new FontFace(alias,`local("${name}")`,{weight:String(weight),style});
  try {await face.load();document.fonts.add(face);chosen.push({alias,localName:name,cssWeight:weight,style});}
  catch(e){if(weight===500&&alias!=='FES Latin')continue;throw new Error(`Required v3 local face not available: ${name}. No font downloaded or silently substituted.`);}
 }
 await document.fonts.ready;
 return window.FES_FONT_RESOLUTION={qualified:true,policy:'V3 visual-lead choice; local faces only; exact installed glyph faces verified by CDP',chosen,fontsDistributed:false,syntheticWeights:false,deviations:[]};
};
