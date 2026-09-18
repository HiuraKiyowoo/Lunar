/**
 * lunar-vidlink-transform.js
 * ===========================
 * Salinan algoritma transformasi URL milik player VidLink (modul webpack 5196).
 *
 * Fungsi utama: mod.D(rawJson, proxyBase)
 *   → mengubah respons /api/b/movie/{token} menjadi URL yang bisa diputar:
 *       mp4 requiresProxy → "<proxyBase>/mp/<path>?sign=&t=&headers=<json>&host=<cdn>"
 *       dash requiresProxy → "<proxyBase>/sacdn/<path>?host=&sc=<base64 cookie>"
 *
 * PENTING:
 *  · CDN (bcdn*.hakunaymatata.com) MENOLAK akses langsung (428/429).
 *  · Yang boleh mengakses CDN hanyalah perantara noon.mooncase.online,
 *    karena server itu membuat sendiri tanda tangan CloudFront (sc).
 *  · Karena itu permintaan HARUS lewat "<proxyBase>" (bawaan: noon.mooncase.online).
 */

const t = {};
t.d = (obj, defs) => { for (const k in defs) Object.defineProperty(obj, k, { get: defs[k], enumerable: true }); };
const e = module.exports;
"use strict";let r=new Set(["headers","host"]),l=new Set(["headers","host","sc"]),o=new Set(["auth","expires","hash","key","sign","t","token"]),i=e=>null!==e&&"object"==typeof e&&!Array.isArray(e),a=e=>JSON.parse(JSON.stringify(e)),u=e=>{let t=e.indexOf("="),n=-1===t?e:e.slice(0,t);try{return decodeURIComponent(n.replaceAll("+"," ")).toLowerCase()}catch(e){return n.toLowerCase()}},c=(e,t)=>e.split("&").filter(Boolean).filter(e=>t(u(e))).join("&"),s=function(e){let t=arguments.length>1&&void 0!==arguments[1]?arguments[1]:r;return e.search.slice(1).split("&").filter(Boolean).some(e=>t.has(u(e)))},d=e=>{if("string"!=typeof e||0===e.length)return null;try{let t=new URL(e);if("http:"!==t.protocol&&"https:"!==t.protocol||!t.hostname||t.username||t.password||t.hash)return null;return t}catch(e){return null}},f=e=>{if(null==e)return{};if(!i(e))return null;let t={};for(let[n,r]of Object.entries(e)){if("string"!=typeof r||/[\0\r\n]/.test(n+r))return null;t[n]=r}return t},p=e=>{let t=d(e);return!t||"/"!==t.pathname||t.search?null:t.origin},h=e=>{let t=f(e);return t?JSON.stringify(Object.fromEntries(Object.entries(t).sort((e,t)=>{let[n]=e,[r]=t;return n.localeCompare(r)}))):null},y=(e,t)=>[e,t.map(e=>{let[t,n]=e;return"".concat(t,"=").concat(encodeURIComponent(n))}).join("&")].filter(Boolean).join("&"),m=(e,t,n,r)=>{if(!t)return null;let l=d(e.url),o=h(e.headers);if(!l||null===o||s(l))return null;let i=y(c(l.search.slice(1),r),[["headers",o],["host",l.origin]]);return"".concat(t,"/").concat(n).concat(l.pathname,"?").concat(i)},g=(e,t)=>{if(!i(e))return null;let n=t.toLowerCase();for(let[t,r]of Object.entries(e))if(t.toLowerCase()===n&&"string"==typeof r)return r;return null},b=e=>{let t=new TextEncoder().encode(e),n="";for(let e of t)n+=String.fromCharCode(e);return btoa(n).replaceAll("+","-").replaceAll("/","_").replace(/=+$/,"")},v=(e,t)=>{if(!t)return null;let n=d(e.url),r=g(e.headers,"cookie");if(!n||!r||s(n,l))return null;let o=y(n.search.slice(1),[["host",n.origin],["sc",b(r)]]);return"".concat(t,"/sacdn").concat(n.pathname,"?").concat(o)},x=(e,t)=>{if(!i(e))return{};let n={};for(let[r,l]of Object.entries(e)){if(!i(l)||"mp4"!==l.type)continue;if(!0!==l.requiresProxy){n[r]={...l};continue}let e=m(l,t,"mp",e=>o.has(e));e&&(n[r]={...l,url:e})}return n},w=(e,t)=>{if(!i(e))return{};let n={};for(let[l,o]of Object.entries(e)){if(!i(o)||"dash"!==o.type&&"hls"!==o.type)continue;if(!0!==o.requiresProxy){n[l]={...o};continue}let e={url:o.playlist,headers:o.headers},a="dash"===o.type?v(e,t):m(e,t,"proxy",e=>!r.has(e));a&&(n[l]={...o,playlist:a})}return n},j=function(e){let t=arguments.length>1&&void 0!==arguments[1]?arguments[1]:"https://noon.mooncase.online/";try{if(!i(e)||!i(e.stream))return null;let n=p(t),l=a(e),o=l.stream;if(o.qualities=x(o.qualities,n),"string"==typeof o.playlist&&!0===o.requiresProxy){let e={url:o.playlist,headers:o.playlistHeaders},t="dash"===o.deliveryType?v(e,n):m(e,n,"proxy",e=>!r.has(e));t?o.playlist=t:(delete o.playlist,delete o.playlistHeaders,delete o.requiresProxy)}return o.alternates=w(o.alternates,n),0===Object.keys(o.alternates).length&&delete o.alternates,Object.keys(o.qualities).length>0||"string"==typeof o.playlist?l:null}catch(e){return null}}
t.D=j;

module.exports=t;
