const Logger = require("node-red-contrib-logger");
const logger = new Logger("biometricvision");
logger.sendInfo("Copyright 2020 Jaroslav Peter Prib");


//const stream = require('stream');
//import { Readable } from 'stream';

function imageJPEG(data){
	/*
	 * new Readable({
		                        read() {
		                            this.push(buffer);
		                          },
		                        })
	 */
	if(data) {
		const buffer = new Buffer(data, 'base64');
		return {
	  	  data: buffer,
	  	  filename: 'image1.jpeg',
	  	  mimetype: 'image/jpeg'
	  	};
	} else return null;
}

const hostURL='https://bvengine.com',
	compareURL=hostURL+'/api/compare',
	tokenURL=hostURL+'/oauth/token',
	request=require('request');

module.exports = function(RED) {
    function biometricCompareNode(config) {
        RED.nodes.createNode(this, config);
        let node=Object.assign(this,config);
        node.status({fill: "yellow", shape: "dot", text: "Awaiting request"});
        if(!node.credentials) {
        	node.status({fill: "red", shape: "dot", text: "No credentials"});
        	return;
        }
//		node.reqTimeout = parseInt(RED.settings.httpRequestTimeout || 60000);
		node.getToken= function (msg) {
			if(msg.biometricvisionConnectTried) {
 				node.sendError(msg,"get token has be tried,in loop");
 				return;
			}
			if(logger.active) logger.send({label:"getToken",user:node.user});
			request.post({
		        url: tokenURL, 
		        json: true,
		        json: {
					    "client_id": node.credentials.user,
						"client_secret": node.credentials.password,
						"grant_type": "client_credentials"
					}
		    }, function(error, response, body) {
		    	if(node.logResponse) logger.send({label:"gettoken reponse",response:response});
              	if (error) {
 					node.sendError(msg,error);
                } else{
					if(logger.active) logger.send({label:"getToken response",user:node.user});
   					try{
   						node.connection = body;
   					} catch(e){
   						node.error(e);
   						logger.send({label:"sendCompare response",body:body});
   						node.sendError(msg,"gettoken unexpected error, response object parsing error");
   	 					return;
   	 				}
	        		node.status({fill: "green", shape: "dot"});
	        		msg.biometricvisionConnectTried=true;
	        		node.headers = {
    					'Authorization':'Bearer '+node.connection.access_token,
    					'X-API-KEY': '328a47240f46a0f20be631116ac56bd3',
    					"Content-Type": "application/json" 
//   						'Content-Type': 'multipart/form-data'
//							'Content-Type':     'application/x-www-form-urlencoded'
   					};
					if(logger.active) logger.send({label:"getToken ok",response:node.connection});
	        		node.sendCompare(msg);
                }
			});
		};
		node.sendCompare=function (msg) {
			if(logger.active) logger.send({label:"sendCompare"});
			if(!node.connection){
        		node.getToken(msg);
        		return;
			}
			try{
				request.post({
			        url: compareURL, 
			        headers: node.headers,
			        followAllRedirects: true,
			        json: true,
			        formData: {image1:imageJPEG(msg.payload.image1),image2:imageJPEG(msg.payload.image1)}
			    }, function(error, response, body) {
			    	if(logger.active)  logger.send({label:"sendCompare response",response:response});  
					try{
						if(error) throw Error(error);
						if(!response) throw Error('no response');
						if(response.statusCode !== 200) throw Error(compareURL+' returns statusCode: '+response.statusCode);
						msg.payload=body;
					} catch(e){
						node.error(e);
//						logger.send({label:"sendCompare response",response:response});
						msg.payload=body;
						node.sendError(msg,"Unexpected error, response object parsing error");
						return;
	   	 			}
					node.send(msg);
			    });
			} catch(e) {
				node.error(e);
				node.sendError(msg,"Unexpected error, response object parsing error");
				logger.send({label:"sendCompare request error",error:e});
			}
		};
		this.sendError= function(msg,error) {
				node.status({fill: "red",shape: "ring",text: error});
				node.warn(RED._("Error: "+error));
                msg.error = error;
                msg.statusCode = 400;
                node.send([null,null,msg]); 
		};
        node.on("input", function(msg) {
 			if(!msg.payload) {
 				node.sendError(msg,'message missing payload');
//        	} else if(!msg.payload.image1) {
// 				node.sendError(msg,'message payload missing property image1');
//        	} else if(!msg.payload.image2) {
// 				node.sendError(msg,'message payload missing property image2');
        	} else {
    			if(logger.active) logger.send({label:"input passed tests"});
            	node.sendCompare(msg);
        	}
        });
    } 

    RED.nodes.registerType("Biometric Compare", biometricCompareNode, {
        credentials: {
            user: {
                type: "text"
            },
            password: {
                type: "password"
            }
        }
    });

};