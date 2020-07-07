const logger = new (require("node-red-contrib-logger"))("Biometric Compare");
logger.sendInfo("Copyright 2020 Jaroslav Peter Prib");

const useHTTPS=true,  // set to false to request 
	hostURL='https://biometricvisionapi.com',
	compareAPI='/v1/compare?ref=nodered',
	compareURL=hostURL+compareAPI,
	Jimp=require('jimp'),
	https=require("https"),
	request=require('request'),
	Readable=require('stream').Readable,
	FormData=require('form-data');
	
function objectType(value) {
	if(value instanceof Buffer) return 'buffer';
	if(value instanceof Readable) return 'stream';
	if(value instanceof String) return 'string';
	const regex = /^[object (S+?)]$/;
	const matches = Object.prototype.toString.call(value).match(regex) || [];
	return (matches[1] || 'undefined').toLowerCase();
}

function buffer2Stream(buffer) {
	if(logger.active) logger.send({label:"buffer2Stream"});
	const readable = new Readable();
	readable._read = () => {}; // _read is required but you can noop it
	readable.push(buffer);
	readable.push(null);
	return readable;
}
function image2Stream(name,buffer){
	if(logger.active) logger.send({label:"image2Stream"});
	return {
		value: buffer, 
		options: {filename: name}
	}
}
/*
function optionsGetToken(length){
	return {
			hostname: 'bvengine.com',  
//			port: 443,
			path: '/oauth/token',
			method: 'POST',
			headers: {
				"accept": "*"+"/"+"*",
				"content-length": length,
				"Content-Type": "application/json"
			},
//			requestCert:false,
			timeout:10000 // ten seconds
	};
}
function getTokenHTTP(msg,callback) {
	const node=this;
	try{
		if(msg.biometricvisionConnectTried) {
			logger.send({label:"getToken loop",headers:node.headers,msg:msg._msgid});
			throw Error("get token has been tried, in loop for msg: "+msg._msgid);
		}
		node.waitOnToken.push({msg:msg,callback:callback,node:this});
		msg.biometricvisionConnectTried=true;
		if(logger.active) logger.send({label:"getToken",user:node.credentials.user});
		if(!node.credentials.user)  throw Error("user not specified");
		if(!node.credentials.password)  throw Error("password not specified");
		if(!node.credentials.xtoken)  throw Error("x-Token not specified");
	} catch(ex) {
		node.sendError(msg,ex.toString());
		return;
	}
	const tokenData=JSON.stringify({
		"client_id": node.credentials.user,
		"client_secret": node.credentials.password,
		"grant_type": "client_credentials"
	});
	
	const requestToken=https.request(optionsGetToken(tokenData.length), response=>{
		if(logger.active) logger.send({label:"gettoken callback",statusCode:response.statusCode,statusMessage:response.statusMessage,headers:response.headers});
		const {statusCode}=response;
		if(statusCode!=200) {
			node.sendError(msg,"get token failed, status code: "+statusCode+" message "+response.statusMessage);
			logger.sendErrorAndDump("getToken",response);
			return;
		}
		response.setEncoding("utf8");
		let rawData = '';
		
		response.on('error', error=>{
			if(logger.active) logger.sendError({label:"request GetToken response on error",error:error});
			node.sendError(msg,error);
		});
		response.on('data',chunk=>{
			if(logger.active) logger.send({label:"gettoken on data",response:chunk});
			rawData+=chunk;
		})
		response.on('end', () => {
			if(logger.active) logger.send({label:"gettoken on end",response:rawData});
			try {
				const parsedData=JSON.parse(rawData);
				if(logger.active) logger.send({label:"getToken response",user:node.credentials.user});
				try{
					node.credentials.connection=parsedData;
					if(callback){
						callback.apply(node,[msg,node.credentials]);
						return;
					}
				} catch(e){
					node.error(e);
					logger.send({label:"sendCompare response",response:rawData});
					node.sendError(msg,"gettoken unexpected error, response object parsing error");
					return;
				}
				node.status({fill: "green", shape: "dot"});
				optionsCompare.headers["Authorization"]="Bearer "+node.credentials.connection.access_token;
				optionsCompare.headers["X-Token"]=node.credentials.xtoken;
				if(logger.active) logger.send({label:"getToken ok",response:node.credentials.connection});
				
				node.tokenOK=true;
				const m=node.waitOnToken.shift();
				try{
					node.log("new token, retry waiting msg: "+m.msg._msgid+" waiting count: "+node.waitOnToken.length);
					if(m.callback){
						if(logger.active) logger.send({label:"getToken callback",msgid:m.msg._msgid});
						m.callback.apply(m.node,[m.msg]);
					} else {
						node.sendCompare.apply(node,[m.msg]);
					}
				} catch(ex){
					node.error(ex);
					logger.sendErrorAndDump({label:"getToken response",response:response},null,ex);
					if(m.msg) node.sendError(m.msg,"gettoken unexpected error, response object parsing error");
				}
				
			} catch (ex) {
				logger.sendError({label:"request GetToken",error:ex.message,data:tokenData});
				node.sendError(msg,"gettoken unexpected error, response object parsing error");
			}
		});
	}).on('error', error=>{
		if(logger.active) logger.sendError({label:"request GetToken request on error",error:error});
		node.sendError(msg,error);
	});
//	requestToken.setTimeout(timeout[, callback])
	if(logger.active) logger.sendError({label:"gettoken http.write",data:tokenData});
	requestToken.write(tokenData);
	if(logger.active) logger.send({label:"gettoken http.end",url:tokenURL});
	requestToken.end();
}
*/
function releaseStaleImages() {
	const node=this;
	if(logger.active) logger.send({label:"releaseStaleImages"});  
	const staleTimestamp= new Date(Date.now() - (node.imageCacheRetentionSecs * 1000));
	Object.keys(this.imageCache)
	.filter(id=>this.imageCache[id].lastTouched < staleTimestamp)
	.forEach(id=>{
		if(logger.active) logger.send({label:"releaseStaleImages delete",id:id});  
		delete this.imageCache[id];
	});
}
function cacheImage(id,image){
	if(logger.active) logger.send({label:"cacheImage",id:id});  
	if(!image) throw Error("image not sent, id:"+id);
	this.imageCache[id]={image:image,lastTouched:new Date()};
}
/*
function checkStoredImage(id,msg){
	const node=this;
	try{
		msg.payload.image1=node.getCacheImage(id);
		node.sendCompare(msg);
	} catch(ex){ // get from persisted
		node.fs.readFile(node.path.join(node.directoryStore,id+'.jpg'), function(err, data) {
			if(!node.imageCache[id]){  // now in cache, may have been saved
				if(err) {
					node.sendError(msg,"Reference image not found");
					if(logger.active) logger.send({label:"sendCompare request error",error:err});
					return;
				}
				node.cacheImage(id,data);
			}
			msg.payload.image1=node.getCacheImage(id);
			node.sendCompare(msg);
		});
	}
}
*/
function checkImage(id,msg){
	const node=this;
	if(logger.active) logger.send({label:"checkImage",id:id});
	try{
		const image=node.getCacheImage(id);
		if(image) {
			if(image.image) {
				image.lastTouched=new Date();
				return image.image;
			}
		}
	} catch(ex) {}
	if(!node.directoryStore){
		node.sendError(msg,"Reference image not found");
		if(logger.active) logger.send({label:"checkImage failed and no store"});
		return;
	}
	node.fs.readFile(node.path.join(node.directoryStore,id+'.jpg'), function(err, data) {
		if(err) {
			if(node.imageCache[id]){  // in case cached in mean time
				msg.payload.image1=node.imageCache[id];
			}
			node.sendError(msg,"Reference image not found");
			if(logger.active) logger.send({label:"sendCompare request error",error:err});
			return;
		} else {
			node.cacheImage(id,data);
		}
		msg.payload.image1=node.getCacheImage(id);
		node.sendCompare(msg);
	});
}
function getCacheImage(id){
	const image=this.imageCache[id];
	if(!image) throw Error("image not found in cache, id:"+id);
	if(!image.image) throw Error("image lost in cache, id:"+id);
	image.lastTouched=new Date();
	return image.image;
}
function saveImage(id,data){
	const node=this;
	node.fs.writeFile(node.path.join(node.directoryStore,id+'.jpg'), data, 'binary', function(err){
		if(err){
			logger.send({label:"directoryStore",error:err,directory:node.directoryStore});
			const error="directory store " +err;
			node.error(error);
			node.status({fill:"red",shape:"ring",text:error});
			return;
		}
	})
}
function sendCompareHTTP(msg) {
	const node=this;
//	if(logger.active) logger.send({label:"sendCompare",tokenOK:node.tokenOK,waitOnToken:node.waitOnToken.length});
	if(logger.active) logger.send({label:"sendCompare"});
/*	if(!node.tokenOK){
		if(node.waitOnToken.length){
			node.waitOnToken.push({msg:msg,node:this});
			node.warn("token expired get token queued as request outstanding for msg: "+msg._msgid);
		} else {
			if(logger.active) logger.send({label:"sendCompare no credientals so get token for msg: "+msg._msgid});
			node.getToken(msg);
		}
		return;
	} 
*/
	try{
//		const credentials=node.credentials;
		const image1=msg.image1||msg.payload.image1||null;
		const image2=msg.image2||msg.payload.image2||msg.payload||null;
		if(!image1) throw Error("missing image1");
		if(!image2) throw Error("missing image2");
		if(!(image1 instanceof Buffer)) throw Error("image1 is not a buffer stream");
		if(!(image2 instanceof Buffer)) throw Error("image2 is not a buffer stream");

		if(logger.active) logger.send({label:"image type",image1:objectType(image1),image2:objectType(image2)})
		const formData=new FormData();
		formData.append('image1',image1,{filename:'image1'});				 
		formData.append('image2',image2,{filename:'image2'});				 

		msg.requestTS={before:new Date()};
		const options={method:"POST",
			headers: Object.assign({"X-Authentication-Token": node.credentials.token},formData.getHeaders())
		};
		if(logger.active) logger.send({label:"compare https.request",options:options});
		const requestCompare=https.request(compareURL,options, response=>{
			if(logger.active) logger.send({label:"compare http callback",statusCode:response.statusCode,statusMessage:response.statusMessage,headers:response.headers});
			const {statusCode}=response;
			try{
				checkStatus(statusCode);
			} catch(ex) {
				logger.sendError({label:"https.request compare",error:ex.message,options:options});
				node.sendError(msg,"compare request unexpected error");
				node.error(ex);
			}
			response.setEncoding("utf8");
			let rawData = '';
			response.on('data', chunk=>rawData+=chunk);
			response.on('end', ()=>{
				try{
					msg.requestTS.after=new Date();
					msg.requestTS.elapse=msg.requestTS.after-msg.requestTS.before;
					if(logger.active) logger.send({label:"compare response end",response:rawData});
					const body=JSON.parse(rawData);
					body.match=(body.confidence=="Match");
					msg.payload=body;
					if(body.match) node.send(msg)
					else node.send([null,msg]);
					if(!node.stateOK) {
						node.stateOK=true;
						node.status({fill:"green",shape:"ring",text:"processed compares"});
					}
				} catch(ex) {
					logger.sendError({label:"compare http response",error:ex.message});
					node.sendError(msg,error);
					node.error(error);
				}
			});
		}).on('error', error=>{
			logger.sendError({label:"compare http on error compare",error:error});
			node.sendError(msg,error);
			node.error(error);
		}).on('timeout',function(){
			const error="timeout";
			logger.sendError({label:"compare http on timeout compare",error:error});
			node.sendError(msg,error);
			node.error(error);
		});
		formData.pipe(requestCompare);
	} catch(ex) {
		logger.send({label:"sendCompare request error",error:ex.message,stack:ex.stack});
		node.error(ex);
		node.sendError(msg,"Unexpected error, response object parsing error");
	}
}
function checkStatus(statusCode) {
	switch(statusCode) {
		case 200: return;
		case 401: throw Error("token unauthorised");
		case 413: throw Error("images size combined images too large");
		case 429: throw Error("throttle eached, try later or change plans");
		default: throw Error("statusCode: "+statusCode);
	}
}
function sendCompareRequest(msg) {
	const node=this;
	if(logger.active) logger.send({label:"sendCompare"});
//	if(logger.active) logger.send({label:"sendCompare",tokenOK:node.tokenOK,waitOnToken:node.waitOnToken.length});
/*	if(!node.tokenOK){
		if(node.waitOnToken.length){
			node.waitOnToken.push({msg:msg,node:this});
			node.warn("token expired get token queued as request outstanding for msg: "+msg._msgid);
		} else {
			if(logger.active) logger.send({label:"sendCompare no credientals so get token for msg: "+msg._msgid});
			node.getToken(msg);
		}
		return;
	} 
*/	try{
//		const credentials=node.credentials;
		const image1=msg.image1||msg.payload.image1||null;
		const image2=msg.image2||msg.payload.image2||msg.payload||null;
		if(!image1) throw Error("missing image1");
		if(!image2) throw Error("missing image2");
		if(!(image1 instanceof Buffer)) throw Error("image1 is not a buffer stream");
		if(!(image2 instanceof Buffer)) throw Error("image2 is not a buffer stream");

		if(logger.active) logger.send({label:"image type",image1:objectType(image1),image2:objectType(image2)})
		let form = {
			image1:image2Stream('image1.jpg',image1),	
			image2:image2Stream('image1.jpg',image2)	
		};
		msg.requestTS={before:new Date()};
		request.post({
			url: compareURL, 
			headers: node.options.headers,
			json: true,
			formData:form
		}, function(error, response) {
			if(logger.active) logger.send({label:"sendCompare response",response:response});  
			try{
				msg.requestTS.after=new Date();
				msg.requestTS.elapse=msg.requestTS.after-msg.requestTS.before;
				if(error) {
					node.sendError(msg,(error.errno=="ENOTFOUND"?"can't get to "+compareURL:"request error "+error.code));
					return;
				}
				if(!response) throw Error('no response');
				checkStatus(response.statusCode);
				const body=response.body;
				if(body.status && body.status=="error") throw Error(body.message);
				body.match=(body.confidence=="Match");
				msg.payload=body;
				msg.payload=body;
				if(body.match) node.send(msg)
				else node.send([null,msg]);
			} catch(ex){
				try{
/*					if(response.statusCode && response.statusCode == 401) {
						if(node.tokenOK) {
							node.tokenOK=false;
							logger.send({label:"token expired",headers:node.headers});
							node.warn("send compare expired token getting new one for msg: "+msg._msgid);
							node.getToken(msg);
						} else {
							node.waitOnToken.push({msg:msg,node:this});
							node.warn("token expired during call, get token queued as request outstanding for msg: "+msg._msgid);
						}
						return;
					}
*/					node.error(ex.message);
					msg.payload=response.body;
					node.sendError(msg,"Unexpected error, response object parsing error "+ex.message);
				} catch(ex) {
					logger.send({label:"sendCompare response catch error",exception:ex.message,error:error,response:response||"<null>"});
					node.sendError(msg,ex.message);
				}
				return;
			}
//			if(msg.biometricvisionConnectTried) delete msg.biometricvisionConnectTried;
			node.send(msg.payload.match?msg:[null,msg]);
			if(!node.stateOK) {
				node.stateOK=true;
				node.status({fill:"green",shape:"ring",text:"processed compares"});
			}
		});
	} catch(ex) {
		logger.send({label:"sendCompare request error",error:ex.message,stack:ex.stack});
		node.error(ex);
		node.sendError(msg,"Unexpected error, response object parsing error");
	}
}

module.exports = function(RED) {
	function biometricCompareNode(config) {
		RED.nodes.createNode(this, config);
		const node=Object.assign(this,{maxSize:10000000},config,{checkStakeFrequencySecs:60,imageCache:{},imageCacheRetentionSecs:3600});
//		let node=Object.assign(this,config,{checkStakeFrequencySecs:60,imageCache:{},imageCacheRetentionSecs:3600,waitOnToken:[],tokenOK:false});
		node.imageCache={};
		node.saveImage=(()=>false);
		if(node.directoryStore){
			node.fs=require('fs'),
			node.path=require('path');
			node.fs.stat(node.directoryStore, function(err, stats) {
				try{
					if(err) throw Error(err);
					if(!stats.isDirectory()) throw Error("not a directory");
				} catch(ex) {
					logger.send({label:"directoryStore",error:ex.toString(),directory:node.directoryStore});
					const error="directory store " +ex.toString();
					node.error(error);
					node.status({fill:"red",shape:"ring",text:error});
					return;
				}
				node.saveImage=saveImage.bind(node);
				if(logger.active) logger.send({label:"directoryStore",directory:node.directoryStore});
			});
		}
		node.releaseStaleImages=releaseStaleImages.bind(node);
		node.checkImage=checkImage.bind(node);
		node.cacheImage=cacheImage.bind(node);
		node.getCacheImage=getCacheImage.bind(node);
		node.status({fill: "yellow", shape: "dot", text: "Awaiting request"});
		if(node.credentials && node.credentials.token) {
			node.options={
				method: "POST",
				headers: {
					"X-Authentication-Token": node.credentials.token,
					Content: "application/json",
					Accept: "application/json"
				}
			};
		} else {
			node.error("No token supplied");
			node.status({fill: "red", shape: "dot", text: "No token"});
			return;
		}
//		node.reqTimeout = parseInt(RED.settings.httpRequestTimeout || 60000);
//		node.getToken=https?getTokenHTTP.bind(node):getTokenRequest.bind(node);
		node.sendCompare=useHTTPS?sendCompareHTTP.bind(node):sendCompareRequest.bind(node);
		node.sendOk=function(msg,message) {
			node.status({fill: "green",shape: "ring",text: message});
			msg.statusCode=200;
			node.send([null,null,msg]); 
/*			while(node.waitOnToken.length) {
				const m=node.waitOnToken.shift();
				try{
					node.log("new token, retry waiting msg: "+m.msg._msgid+" waiting count: "+node.waitOnToken.length);
					if(m.callback){
						if(logger.active) logger.send({label:"getToken callback",msgid:m.msg._msgid});
						m.callback.apply(m.node,[m.msg]);
					} else {
						node.sendCompare.apply(node,[m.msg]);
					}
				} catch(ex){
					node.error(ex);
					logger.sendErrorAndDump({label:"sendok sendcompare",error:ex.message},null,ex);
					if(m.msg) node.sendError(m.msg,"send compare unexpected error, see logs for details");
				}
			}
*/		};
		node.sendError=function(msg,error) {
				node.status({fill: "red",shape: "ring",text: error});
				node.warn(RED._("Error: "+error));
				msg.error=error;
				msg.statusCode=400;
				node.send([null,null,null,msg]); 
		};
		node.sizeImage=function(msg,imageBuffer,callBack){
			const factor=node.maxSize/imageBuffer.length;
			if(factor>1){
				callBack(msg,imageBuffer);
				return;
			}
			if(logger.active) logger.send({label:"sizeImage resize",factor:factor,size:imageBuffer.length});
			Jimp.read(imageBuffer, (err, image)=>{
				try{
					if(err) throw Error(err);
					image.scale(factor).getBuffer(Jimp.MIME_JPEG, (err,resizedImage)=>{
						try{
							if(err) throw Error(err);
							callBack(msg,resizedImage);
						} catch(ex) {
							node.sendError(msg,'image resize error on scale '+ex.message);
						}
					});
				} catch(ex) {
					node.sendError(msg,'image resize error on read '+ex.message);
				}
			});
		};
		node.on("input", function(msg) {
			if(msg.topic) {
				if(logger.active) logger.send({label:"input",topic:msg.topic});  
				const topicParts=msg.topic.split('/'),
					action=topicParts[0];
				switch(action){
					case "compare":{
						const id=topicParts[1];
						node.sizeImage(msg,msg.payload,(msg,image)=>{
							msg.payload={image2:image};
							node.checkImage(id,msg);
						});
						return;
					}
/*					case "getCredentials":
						node.getToken(msg,msg.payload);
						node.sendOk(msg,"OK");
						return;
					case "setCredentials":
						node.credentials=msg.payload;
						node.sendOk(msg,"OK");
						return;
*/					case "save":
					case "cache":
						node.sizeImage(msg,msg.payload,(msg,image)=>{
							if(action=="save") node.saveImage(topicParts[1],image);
							node.cacheImage(topicParts[1],image);
						});
						node.sendOk(msg,"OK");
						return;
					case "flushCache":
						node.imageCache={};
						node.log("cache cleared");
						node.sendOk(msg,"cache cleared");
						return;
/*					case "testCredentials":
						node.getToken(msg,token=>node.sendOk(msg,"OK token: "+token));
						return;
*/					default:
						break;
				}
			}
			if(logger.active) logger.send({label:"compare sent images"});
			try{
				if(!msg.payload) throw Error("no payload");
				if(!msg.payload.image1) throw Error("no image1 in payload");
				if(!msg.payload.image2) throw Error("no image2 in payload");
				node.sizeImage(msg,msg.payload.image1,(msg,image1)=>{
					try{
						msg.payload.image1=image1;
						node.sizeImage(msg,msg.payload.image2,(msg,image2)=>{
							msg.payload.image2=image2;
							try{
								node.sendCompare(msg);
							} catch(ex) {
								node.error("sendCompare issue: "+ex.message);
								logger.sendErrorAndDump({error:ex.message});
							}
						});
					} catch(ex) {
						node.error("issue image 2: "+ex.message);
						logger.sendErrorAndDump({error:ex.message});
					}
				});
			} catch(ex) {
				node.error(ex.message);
				logger.sendErrorAndDump({label:"input",topic:msg.topic,error:ex.message},null,ex);
			}
		});
		node.releaseStaleImagesProcess = setInterval((node)=>node.releaseStaleImages(node), 1000*(node.checkStakeFrequencySecs||60),node);
		node.on("close", function(removed,done) {
			clearInterval(node.releaseStaleImagesProcess); 
			done();
		});
	} 

	RED.nodes.registerType(logger.label, biometricCompareNode, {
		credentials: {
/*			user: {type: "text"},
			password: {type: "password"},
*/			token: {type: "text"},
		}
	});
};