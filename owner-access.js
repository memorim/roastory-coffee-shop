import {createHash,timingSafeEqual} from 'node:crypto';
export function ownerAccess(env=process.env) {
 const token=env.APP_OWNER_TOKEN;
 return (req,res,next)=>{
  res.set('Cache-Control','no-store');
  if(!token||token.length<32)return res.status(503).json({message:'Owner access is not configured'});
  const supplied=(req.get('authorization')||'').replace(/^Bearer /,'');
  const hash=x=>createHash('sha256').update(x).digest();
  if(supplied.length>256||!timingSafeEqual(hash(supplied),hash(token)))return res.status(401).json({message:'Authentication required'});
  next();
 };
}
export function publicOrigin(env=process.env) {
 if(!env.APP_PUBLIC_ORIGIN)return null;
 const u=new URL(env.APP_PUBLIC_ORIGIN);
 if(u.protocol!=='https:'||u.origin!==env.APP_PUBLIC_ORIGIN)throw new Error('APP_PUBLIC_ORIGIN must be an HTTPS origin');
 if(!env.APP_OWNER_TOKEN||env.APP_OWNER_TOKEN.length<32)throw new Error('Public hosting requires APP_OWNER_TOKEN');
 return u;
}
