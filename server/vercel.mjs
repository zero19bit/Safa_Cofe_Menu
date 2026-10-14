import { handle } from './app.mjs';

export async function serve(req,res,path) {
  const protocol=process.env.VERCEL?'https':'http';
  const origin=process.env.APP_ORIGIN||`${protocol}://${req.headers.host}`;
  const headers=new Headers();
  for(const [key,val] of Object.entries(req.headers))if(val!==undefined)headers.set(key,Array.isArray(val)?val.join(', '):val);
  let payload;
  if(!['GET','HEAD'].includes(req.method)) {
    if(req.body!==undefined)payload=typeof req.body==='string'||Buffer.isBuffer(req.body)?req.body:JSON.stringify(req.body);
    else {
      const chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>3000000){res.statusCode=413;res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify({error:{code:'body_too_large',message:'حجم درخواست بیش از حد مجاز است.'}}));return;}chunks.push(chunk);}
      payload=Buffer.concat(chunks);
    }
  }
  const request=new Request(new URL(path,origin),{method:req.method,headers,...(payload!==undefined?{body:payload}:{})});
  const response=await handle(request);
  res.statusCode=response.status;
  response.headers.forEach((value,key)=>res.setHeader(key,value));
  res.end(await response.text());
}
