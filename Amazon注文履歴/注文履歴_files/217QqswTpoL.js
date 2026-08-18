////////////////////////////////////////////
;(function (packageFunction) {
  /* istanbul ignore next */
  var p = window.AmazonUIPageJS || window.P;
  /* istanbul ignore next */
  var attribute = p._namespace || p.attributeErrors;
  /* istanbul ignore next */
  var namespacedP = attribute ? attribute("CPSContextJSBuzzWrapper", "") : p;

  /* istanbul ignore next */
  if (namespacedP.guardFatal) {
    namespacedP.guardFatal(packageFunction)(namespacedP, window);
  } else {
    namespacedP.execute(function () {
      packageFunction(namespacedP, window);
    });
  }
}(function(P, window, undefined){
// BEGIN ASSET CPSContextJSBuzzWrapper - 1.0
/////////////////////////
// BEGIN FILE placeholder.js
/////////////////////////
/*


Full source (including license, if applicable) included below.
*/
/******
 Empty place holder file as required by Buzz

 */
/////////////////////////
// END FILE placeholder.js
/////////////////////////
/////////////////////////
// BEGIN FILE app.js
/////////////////////////
/*


Full source (including license, if applicable) included below.
*/
"use strict";var t,e=function(){return e=Object.assign||function(t){for(var e,n=1,r=arguments.length;n<r;n++)for(var o in e=arguments[n])Object.prototype.hasOwnProperty.call(e,o)&&(t[o]=e[o]);return t},e.apply(this,arguments)};"function"==typeof SuppressedError&&SuppressedError;var n=new Uint8Array(16);function r(){if(!t&&!(t="undefined"!=typeof crypto&&crypto.getRandomValues&&crypto.getRandomValues.bind(crypto)||"undefined"!=typeof msCrypto&&"function"==typeof msCrypto.getRandomValues&&msCrypto.getRandomValues.bind(msCrypto)))throw new Error("crypto.getRandomValues() not supported. See https://github.com/uuidjs/uuid#getrandomvalues-not-supported");return t(n)}var o=/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000)$/i;for(var i=[],a=0;a<256;++a)i.push((a+256).toString(16).substr(1));function s(t){var e=arguments.length>1&&void 0!==arguments[1]?arguments[1]:0,n=(i[t[e+0]]+i[t[e+1]]+i[t[e+2]]+i[t[e+3]]+"-"+i[t[e+4]]+i[t[e+5]]+"-"+i[t[e+6]]+i[t[e+7]]+"-"+i[t[e+8]]+i[t[e+9]]+"-"+i[t[e+10]]+i[t[e+11]]+i[t[e+12]]+i[t[e+13]]+i[t[e+14]]+i[t[e+15]]).toLowerCase();if(!function(t){return"string"==typeof t&&o.test(t)}(n))throw TypeError("Stringified UUID is invalid");return n}function c(t,e,n){var o=(t=t||{}).random||(t.rng||r)();if(o[6]=15&o[6]|64,o[8]=63&o[8]|128,e){n=n||0;for(var i=0;i<16;++i)e[n+i]=o[i];return e}return s(o)}var u=["customerId","marketplaceId","locale","timestamp","eventCategory","eventType","eventData"],l=function(){function t(t,e){this.metricsCollector=t,this.clientIdentifier=e}return t.prototype.publishContextToSushi=function(t,e,n){if(t)if(0!==Object.keys(e).length&&this.isValidEvent(e)){"1"===(null==e?void 0:e.customerId)?this.metricsCollector.publishToCSM("unauthContextEvent-".concat(this.clientIdentifier)):this.metricsCollector.publishToCSM("authContextEvent-".concat(this.clientIdentifier));var r={customerId:e.customerId,sessionId:e.sessionId,marketplaceId:e.marketplaceId,locale:e.locale,timestamp:e.timestamp,eventCategory:e.eventCategory,eventType:e.eventType,eventData:e.eventData,eventId:e.eventId||c()};this.metricsCollector.publishContextEventToSushi(t,r,n)}else this.metricsCollector.publishToCSM("invalidContextEvent-".concat(this.clientIdentifier));else this.metricsCollector.publishToCSM("invalidSushiEndpoint-".concat(this.clientIdentifier))},t.prototype.isValidEvent=function(t){return u.every(function(e){var n=e;return null!==t[n]&&""!==t[n]})},t}(),d=function(){function t(t){this.clientIdentifier=t}return t.prototype.publishContextEventsToSushi=function(t,e,n){var r=this,o={events:[]};o.events=e.map(function(t){return{data:t}});try{if(n)return void this.useNavigatorSendBeacon(t,o)}catch(t){this.publishToCSM("errorSendingEventToSushiUsingSendBeacon-".concat(this.clientIdentifier))}try{var i={method:"POST",headers:{"Content-Type":"application/json"},keepalive:!0,body:JSON.stringify(o)};fetch(t,i).then(function(t){200!==t.status&&r.publishToCSM("".concat(t.status,"-errorSendingEventToSushi-").concat(r.clientIdentifier))}).catch(function(t){r.publishToCSM("errorSendingEventToSushi-".concat(r.clientIdentifier))})}catch(t){console.warn("Error serializing and sending data to sushi. "+t.message),this.publishToCSM("errorSendingEventToSushi-".concat(this.clientIdentifier))}},t.prototype.useNavigatorSendBeacon=function(t,e){navigator.sendBeacon(t,JSON.stringify(e))},t.prototype.publishContextEventToSushi=function(t,e,n){this.publishContextEventsToSushi(t,[e],n)},t.prototype.publishToCSM=function(t){var e=window.ue;e&&e.count&&e.count(t,1)},t}(),p=function(){function t(){}return t.getUrlWithoutParams=function(t){return t?t.split("?")[0]:""},t.logError=function(t,e){var n=window.ue;n&&n.count&&(n.count("cps-error-".concat(t),1),n.count("cps-error-total",1));var r={logLevel:"ERROR",attribution:"ContextPreservationServiceJS",message:t+" CPS click capture threw error"};window.ueLogError(e,r)},t.handleClick=function(n,r,o){var i=A.state("cpsData");if(i&&0!==Object.keys(i).length)return function(a){var s,c,u;try{var p=a.currentTarget,h=null!==(s=p.getAttribute("href"))&&void 0!==s?s:void 0;if(r(h,p)){var v=(new Date).toISOString(),f={connectionUrl:h||"",connectionLabel:null!==(u=null===(c=p.textContent)||void 0===c?void 0:c.trim())&&void 0!==u?u:"",clickType:"link"},m={obfuscatedMarketplaceId:i.marketplaceId,customerId:i.customerId,sessionId:i.sessionId,csDataEventId:window.crypto.randomUUID(),eventCreationTimestamp:v,locale:i.locale,clickedElement:{clickType:f.clickType,clickMetadata:{displayableLabel:f.connectionLabel,url:t.getUrlWithoutParams(h)}}},g=o(p,h,i),y={eventCategory:"PreContact",eventType:"CSDataEvent_AmazonRetail_"+n,eventData:JSON.stringify(e(e({},m),g)),customerId:i.customerId,sessionId:i.sessionId,timestamp:v,marketplaceId:i.marketplaceId,locale:i.locale},C=new d(n);new l(C,n).publishContextToSushi(i.sushiEndpoint,y)}}catch(e){e instanceof Error?t.logError(n,e):t.logError(n,new Error(String(e)))}}},t}();P&&P.AUI_BUILD_DATE&&(P.register("MetricsCollector",function(){return d}),P.register("ContextPublisher",function(){return l}),P.register("ClickEventHandler",function(){return p}));
//# sourceMappingURL=index.js.map
/////////////////////////
// END FILE app.js
/////////////////////////

// END ASSET CPSContextJSBuzzWrapper - 1.0
}));
////////////////////////////////////////////