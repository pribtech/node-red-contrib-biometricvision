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
	request=require('request');

module.exports = function(RED) {
    function biometricCompareNode(config) {
        RED.nodes.createNode(this, config);
        let node=Object.assign(this,config,{checkStakeFrequencySecs:60,imageCache:{},imageCacheRetentionSecs:3600});
        node.imageCache={};
    	node.saveImage=(()=>false);     		
        if(node.directoryStore){
        	const fs=require('fs'),
        		path=require('path'),
        		{Readable}=require('stream');
        	fs.stat(node.directoryStore, function(err, stats) {
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
        	        fs.writeFile(path.join(node.directoryStore,id+'.png'), data, 'binary', function(err){
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
        		fs.readFile(path.join(node.directoryStore,id+'.png'), function(err, data) {
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
				if(msg.biometricvisionConnectTried) throw Error("get token has been tried,in loop");
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
			if(!node.connection){
        		node.getToken(msg);
        		return;
			}
			try{
				if(!msg.payload.image1) throw Error("missing image1");
				if(!msg.payload.image2) throw Error("missing image2");
				const image1=msg.payload.image1;
				const image2=msg.payload.image2;
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
			    }, function(error, response, body) {
			    	if(logger.active)  logger.send({label:"sendCompare response",response:response});  
					try{
						msg.requestTS.after=new Date();
						msg.requestTS.elapse=msg.requestTS.after-msg.requestTS.before;
						if(error) throw Error(error);
						if(!response) throw Error('no response');
						if(response.statusCode !== 200) throw Error(compareURL+' returns statusCode: '+response.statusCode);
						msg.payload=body;
					} catch(ex){
						try{
							if(response.statusCode && response.statusCode == 401) {
								node.warn("expired token getting new one");
								node.getToken(msg);
								return;
							}
							node.error(ex);
							msg.payload=response.body;
							node.sendError(msg,"Unexpected error, response object parsing error");
						} catch(e) {
							logger.send({label:"sendCompare response catch error",exception:ex.toString(),error:error,response:response||"<null>"});
						}
						return;
	   	 			}
					body.Confidence=="Match"
					node.send(body.Confidence=="Match"?msg:[null,msg]);
			    });
			} catch(ex) {
				logger.send({label:"sendCompare request error",error:ex.message});
				node.error(ex);
				node.sendError(msg,"Unexpected error, response object parsing error");
			}
		};
		this.sendError=function(msg,error) {
				node.status({fill: "red",shape: "ring",text: error});
				node.warn(RED._("Error: "+error));
                msg.error=error;
                msg.statusCode=400;
                node.send([null,null,msg]); 
		};
        node.on("input", function(msg) {
        	if(msg.topic) {
		    	if(logger.active) logger.send({label:"input",topic:msg.topic});  
        		const topicParts=msg.topic.split('/'),
        			action=topicParts[0];
        		switch(action){
        			case "compare":
        				const id=topicParts[1];
        				msg.payload={image2:msg.payload};
        				if(node.directoryStore){
        					node.checkStoredImage(id,msg);
        				} else {
            				msg.payload.image1=node.getCacheImage(id);
            				node.sendCompare(msg);
        				}
        				return;
        			case "getCredentials":
        				node.getToken(msg,msg.payload,(credentials));
        				return;
        			case "setCredentials":
        				node.credentials=msg.payload;
        				return;
        			case "save":
        				node.saveImage(topicParts[1],msg.payload);
        			case "cache":
        				node.cacheImage(topicParts[1],msg.payload);
        				return;
        			case "flushCache":
        				node.imageCache={};
						node.log("cache cleared");
        				return;
        			default:
        				break;
        		}
        	}
 			if(!msg.payload) {
 				node.sendError(msg,'message missing payload');
        	} else if(!msg.payload.image1) {
 				node.sendError(msg,'message payload missing property image1');
        	} else if(!msg.payload.image2) {
 				node.sendError(msg,'message payload missing property image2');
        	} else {
    			if(logger.active) logger.send({label:"input passed tests"});
            	node.sendCompare(msg);
        	}
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