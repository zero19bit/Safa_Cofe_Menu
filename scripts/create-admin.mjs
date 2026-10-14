import { createInterface } from 'node:readline/promises';
import { configuration, gateway } from '../server/supabase.mjs';
import { uuid } from '../server/validation.mjs';
const rl=createInterface({input:process.stdin,output:process.stdout});
const username=(await rl.question('Admin username (3–64 lowercase letters, digits, _ . -): ')).trim().toLowerCase();
const email=(await rl.question('Admin email: ')).trim();
rl.close();
if(!/^[a-z0-9_.-]{3,64}$/.test(username)||!/^\S+@\S+\.\S+$/.test(email))throw new Error('Username or email is invalid.');
if(!process.stdin.isTTY)throw new Error('Run this command in an interactive terminal to keep the password hidden.');
function secretQuestion(){return new Promise((resolve,reject)=>{let value='';process.stdout.write('Password (hidden; at least 12 characters, maximum 72 UTF-8 bytes): ');process.stdin.setRawMode(true);process.stdin.resume();const onData=buf=>{for(const char of buf.toString('utf8')){if(char==='\r'||char==='\n'){process.stdin.off('data',onData);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');resolve(value);return;}if(char==='\u0003'){process.stdin.setRawMode(false);process.stdin.pause();reject(new Error('Cancelled'));return;}if(char==='\u007f'||char==='\b')value=value.slice(0,-1);else if(char>=' ')value+=char;}};process.stdin.on('data',onData);});}
const password=await secretQuestion();if(password.length<12||Buffer.byteLength(password)>72)throw new Error('Password must be at least 12 characters and at most 72 UTF-8 bytes.');
const db=gateway(configuration());
const created=await db('/auth/v1/admin/users',{method:'POST',body:{email,password,email_confirm:true},allowFailure:true});
if(!created.ok)throw new Error('Could not create Auth user. Check configuration, password policy or whether the email already exists.');
const id=uuid(created.data?.id??created.data?.user?.id);
try{await db('/rest/v1/admins',{method:'POST',body:{id,username,email}});}
catch(e){await db(`/auth/v1/admin/users/${id}`,{method:'DELETE',allowFailure:true});throw e;}
console.log('Admin created. Sign in at /admin. No password or API key has been written to a project file.');
