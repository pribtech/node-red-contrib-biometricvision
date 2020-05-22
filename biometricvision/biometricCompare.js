const Logger = require("node-red-contrib-logger");
const logger = new Logger("biometricvision");
logger.sendInfo("Copyright 2020 Jaroslav Peter Prib");

/*
function objectType(value) {
	if(value instanceof Buffer) return 'buffer';
	if(value instanceof Readable) return 'stream';
	if(value instanceof String) return 'string';
	const regex = /^[object (S+?)]$/;
	const matches = Object.prototype.toString.call(value).match(regex) || [];
	return (matches[1] || 'undefined').toLowerCase();
}
*/

function image2Stream(name,buffer){
	return {
         value: buffer, 
         options: {filename: name}
	}
}
const hostURL='https://bvengine.com',
	compareAPI='/api/compare',
	compareURL=hostURL+'/api/compare',
	tokenURL=hostURL+'/oauth/token',
	maxImageSize=1000000,
	cachemaxImageSize=1000000,
	request=require('request'),
	Jimp=require('jimp');

module.exports = function(RED) {
    function biometricCompareNode(config) {
        RED.nodes.createNode(this, config);
        let node=Object.assign(this,config,{checkStakeFrequencySecs:60,imageCache:{},imageCacheRetentionSecs:3600});
        node.imageCache={};
    	node.saveImage=(()=>false);     		
        if(node.directoryStore){
        	node.fs=require('fs'),
        	node.path=require('path'),
        	//const	{Readable}=require('stream');
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
        		node.saveImage=function(id,data){
        	        node.fs.writeFile(node.path.join(node.directoryStore,id+'.jpg'), data, 'binary', function(err){
        	            if(err){
        	    			logger.send({label:"directoryStore",error:ex.toString(),directory:node.directoryStore});
        	    			const error="directory store " +ex.toString()
        	        	    node.error(error);
        	        	    node.status({fill:"red",shape:"ring",text:error});
        	    			return;
        	            }
        	        })
        		}
				if(logger.active) logger.send({label:"directoryStore",directory:node.directoryStore});
	        });
        }
        node.releaseStaleImages=function() {
	    	if(logger.active) logger.send({label:"releaseStaleImages"});  
        	const staleTimestamp= new Date(Date.now() - (node.imageCacheRetentionSecs * 1000));
        	Object.keys(node.imageCache)
        		.filter(id=>node.imageCache[id].lastTouched < staleTimestamp)
        		.forEach(id=>{
        	    	if(logger.active) logger.send({label:"releaseStaleImages delete",id:id});  
        			delete node.imageCache[id];
        		});
        };
        node.checkStoredImage=function(id,msg){
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
       	};
        node.cacheImage=function(id,image){
	    	if(logger.active) logger.send({label:"cacheImage",id:id});  
        	if(!image) throw Error("image not sent, id:"+id);
        	node.imageCache[id]={image:image,lastTouched:new Date()};
        };
        node.getCacheImage=function(id){
        	const image=node.imageCache[id];
        	if(!image) throw Error("image not found in cache, id:"+id);
        	if(!image.image) throw Error("image lost in cache, id:"+id);
        	image.lastTouched=new Date();
        	return image.image;
        };
        
        node.status({fill: "yellow", shape: "dot", text: "Awaiting request"});
        if(!node.credentials) {
        	node.status({fill: "red", shape: "dot", text: "No credentials"});
        	return;
        }
//		node.reqTimeout = parseInt(RED.settings.httpRequestTimeout || 60000);
		node.getToken= function (msg,credentials=node.credentials,callback) {
			try{
				if(msg.biometricvisionConnectTried) {
					logger.send({label:"getToken loop",headers:node.headers});
					throw Error("get token has been tried,in loop");
				}
				msg.biometricvisionConnectTried=true;
				if(logger.active) logger.send({label:"getToken",user:credentials.user});
		        if(!credentials.user)  throw Error("user not specified");
		        if(!credentials.password)  throw Error("password not specified");
		        if(!credentials.xtoken)  throw Error("x-Token not specified");
			} catch(ex) {
 				node.sendError(msg,ex.toString());
	        	return;
			}
			request.post({
		        url: tokenURL, 
		        json: true,
		        json: {
					    "client_id": credentials.user,
						"client_secret": credentials.password,
						"grant_type": "client_credentials"
					}
		    }, function(error, response, body) {
		    	if(logger.active) logger.send({label:"gettoken reponse",response:response});
              	if (error) {
 					node.sendError(msg,error);
                } else{
					if(logger.active) logger.send({label:"getToken response",user:credentials.user});
   					try{
   						credentials.connection = body;
   						if(callback){
   							callback.apply(this,[msg,credentials]);
   							return;
   						}
   					} catch(e){
   						node.error(e);
   						logger.send({label:"sendCompare response",response:response});
   						node.sendError(msg,"gettoken unexpected error, response object parsing error");
   	 					return;
   	 				}
	        		node.status({fill: "green", shape: "dot"});
	        		node.headers = {
    					'Authorization':'Bearer '+credentials.connection.access_token,
    					'X-Token': node.credentials.xtoken,
    					"Content-Type": "application/json",
   					};
					if(logger.active) logger.send({label:"getToken ok",response:credentials.connection});
	        		node.sendCompare(msg);
                }
			});
		};
		node.sendCompare=function (msg) {
			const credentials=node.credentials;
			if(logger.active) logger.send({label:"sendCompare"});
			if(!credentials){
				if(logger.active) logger.send({label:"sendCompare no credientals so get token"});
        		node.getToken(msg);
        		return;
			}
			try{
				const image1=msg.image1||msg.payload.image1||null;
				const image2=msg.image2||msg.payload.image2||msg.payload||null;
				if(!image1) throw Error("missing image1");
				if(!image2) throw Error("missing image2");
				if(!(image1 instanceof Buffer)) throw Error("image1 is not a buffer stream");
				if(!(image2 instanceof Buffer)) throw Error("image2 is not a buffer stream");

//				if(logger.active) logger.send({label:"image type",image1:objectType(image1),image2:objectType(image2)})
				let form = {
					image1:image2Stream('image1.jpg',image1),	
					image2:image2Stream('image1.jpg',image2)	
				};
				if(logger.active) logger.send({label:"request to bio"});
				msg.requestTS={before:new Date()};
				request.post({
			        url: compareURL, 
			        headers: node.headers,
			        followAllRedirects: true,
			        json: true,
			        formData:form
			    }, function(error, response) {
			    	if(logger.active) logger.send({label:"sendCompare response",response:response});  
					try{
						msg.requestTS.after=new Date();
						msg.requestTS.elapse=msg.requestTS.after-msg.requestTS.before;
						if(error) throw Error(error);
						if(!response) throw Error('no response');
						if(response.statusCode == 413) throw Error("images size combined images too large");
						if(response.statusCode !== 200) throw Error(compareURL+' returns statusCode: '+response.statusCode);
						const body=response.body;
						if(body.status && body.status=="error") throw Error(body.message);
						msg.payload={
						    match: msg.payload.Confidence=="Match",
						    features:{
						        brow:{left:parseFloat(body["Left Brow"]),     right:parseFloat(body["Right Brow"])},
						        cheek:{left:parseFloat(body["Left Cheek"]),   right:parseFloat(body["Right Cheek"])},  
						        eye:{left:parseFloat(body["Left Eye"]),       right:parseFloat(body["Right Eye"])},  
						        forehead:{base:parseFloat(body.Forehead),     middle:parseFloat(body["Middle Forehead"])},
						        nose:parseFloat(body.Nose),
						        mouth:parseFloat(body.Mouth),
						        philtrum:parseFloat(body.Philtrum),
						        jaw:parseFloat(body.Jaw)
						    }
						};
					} catch(ex){
						try{
							if(response.statusCode && response.statusCode == 401) {
								node.warn("expired token getting new one");
								node.getToken(msg);
								return;
							}
							node.error(ex);
							msg.payload=response.body;
							node.sendError(msg,"Unexpected error, response object parsing error "+ex.message);
						} catch(e) {
							logger.send({label:"sendCompare response catch error",exception:ex.toString(),error:error,response:response||"<null>"});
						}
						return;
	   	 			}
					node.send(msg.payload?msg:[null,msg]);
			    });
			} catch(ex) {
				logger.send({label:"sendCompare request error",error:ex.message,stack:ex.stack});
				node.error(ex);
				node.sendError(msg,"Unexpected error, response object parsing error");
			}
		};
		node.sendOk=function(msg,message) {
			node.status({fill: "green",shape: "ring",text: message});
            msg.statusCode=200;
            node.send([null,null,msg]); 
		};
		node.sendError=function(msg,error) {
				node.status({fill: "red",shape: "ring",text: error});
				node.warn(RED._("Error: "+error));
                msg.error=error;
                msg.statusCode=400;
                node.send([null,null,null,msg]); 
		};
		node.sizeImage=function(msg,imageBuffer,callBack){
			const factor=maxImageSize/imageBuffer.length;
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
        			case "compare":
        				const id=topicParts[1];
        				node.sizeImage(msg,msg.payload,(msg,image)=>{
            				msg.payload={image2:image};
            				if(node.directoryStore){
            					node.checkStoredImage(id,msg);
            				} else {
                				msg.payload.image1=node.getCacheImage(id);
                				node.sendCompare(msg);
            				}
        				});
        				return;
        			case "getCredentials":
        				node.getToken(msg,msg.payload,(credentials));
        				node.sendOk(msg,"OK");
        				return;
        			case "setCredentials":
           			 	node.credentials=msg.payload;
           				node.sendOk(msg,"OK");
        				return;
        			case "save":
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
        			default:
        				break;
        		}
        	}
   			if(logger.active) logger.send({label:"compare sent images"});
			node.sizeImage(msg,msg.payload.image1,(msg,image1)=>{
				msg.payload.image1=image1;
				node.sizeImage(msg,msg.payload.image2,(msg,image2)=>{
					msg.payload.image2=image2;
	            	node.sendCompare(msg);
				});
			});
        });
       	node.releaseStaleImagesProcess = setInterval(function(node) {node.releaseStaleImages.apply(node)}, 1000*(node.checkStakeFrequencySecs||60),node);
       	node.on("close", function(removed,done) {
            clearInterval(node.releaseStaleImagesProcess); 
       		node.connectionPool.close(done);
       	});
    } 

    RED.nodes.registerType("Biometric Compare", biometricCompareNode, {
        credentials: {
            user: {
                type: "text"
            },
            password: {
                type: "password"
            },
            xtoken: {
                type: "text"
            },
        }
    });

};