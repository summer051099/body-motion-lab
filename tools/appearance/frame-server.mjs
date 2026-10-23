import http from 'node:http';import fs from 'node:fs/promises';import path from 'node:path';
const root=path.resolve('output/appearance/clips');
const server=http.createServer(async(req,res)=>{
 res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:4173');res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');
 if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
 if(req.method==='POST'&&req.url==='/finish'){res.end('done');server.close();return;}
 const match=/^\/(pushup|squat|curl)\/(\d{4})$/.exec(req.url||'');
 if(req.method!=='POST'||!match){res.writeHead(404);res.end();return;}
 try{const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);if(body.length>4e6)throw Error('Oversize frame');const dir=path.join(root,match[1]);await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'frame-'+match[2]+'.png'),body);res.end('ok');}catch(error){res.writeHead(500);res.end(error.message);}
});server.listen(4188,'127.0.0.1',()=>console.log('Local frame receiver ready'));
