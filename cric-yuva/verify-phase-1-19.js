"use strict";
/*
 * CRIC YUVA Phase 1-19 release verification.
 * Static checks are always run. DB/E2E checks run when DATABASE_URL is available.
 */
const fs=require("fs"), path=require("path"), cp=require("child_process");
const root=__dirname;
const files=["index.html","style.css","script.js","server.js","db.js","phase-engine.js","storage.js","package.json","render.yaml","manifest.webmanifest","sw.js"];
const routes=[
"/api/auth/register","/api/auth/login","/api/auth/request-otp","/api/auth/verify-otp",
"/api/profile","/api/players","/api/teams","/api/tournaments",
"/api/tournaments/:tournamentId/teams","/api/tournaments/:tournamentId/players",
"/api/matches","/api/matches/:matchId/playing-xi","/api/matches/:matchId/innings",
"/api/innings/:inningsId/balls","/api/balls/:ballId","/api/stats/player/:playerId",
"/api/stats/tournament/:tournamentId","/api/friends","/api/friends/request",
"/api/admin/me","/api/live/public/:matchId","/api/live/stream/:matchId",
"/api/broadcast/destinations","/api/subscription/plans","/api/subscription",
"/api/security/backup","/api/security/audit","/api/production/readiness","/api/health"
];
const tests=[]; const ok=(name,pass,detail="")=>tests.push({name,pass:Boolean(pass),detail});
for(const f of files) ok("file exists: "+f,fs.existsSync(path.join(root,f)));
for(const f of ["server.js","db.js","phase-engine.js","script.js"]){
  if(fs.existsSync(path.join(root,f))){
    try{cp.execFileSync(process.execPath,["--check",path.join(root,f)],{stdio:"pipe"});ok("syntax: "+f,true);}
    catch(e){ok("syntax: "+f,false,String(e.stderr||e.message));}
  }
}
const server=fs.readFileSync(path.join(root,"server.js"),"utf8");
for(const r of routes) ok("route present: "+r,server.includes(r));
ok("auth middleware is async",/async function requireAuth\(/.test(server));
ok("optional auth middleware is async",/async function optionalAuth\(/.test(server));
ok("admin middleware is async",/async function requireAdmin\(/.test(server));
ok("playing XI is authenticated",/app\.post\("\/api\/matches\/:matchId\/playing-xi", requireAuth/.test(server));
ok("innings creation is authenticated",/app\.post\("\/api\/matches\/:matchId\/innings", requireAuth/.test(server));
ok("ball creation is authenticated",/app\.post\("\/api\/innings\/:inningsId\/balls", requireAuth/.test(server));
ok("ball deletion is authenticated",/app\.delete\("\/api\/balls\/:ballId", requireAuth/.test(server));
ok("tournament stats use separate batting/bowling aggregates",/WITH match_balls AS/.test(server) && /LEFT JOIN bat ON/.test(server));
ok("free trial duplicate protection exists",/Active free trial already exists/.test(server));
ok("grounds/scorer assignment API present",server.includes("/api/tournaments/:tournamentId/grounds") && server.includes("/api/matches/:matchId/scorers"));
ok("points table + NRR API present",server.includes("/api/tournaments/:tournamentId/points-table") && server.includes("nrr"));
ok("knockout API present",server.includes("/api/tournaments/:tournamentId/knockout"));
ok("match/tournament printable report APIs present",server.includes("/api/reports/match/:matchId") && server.includes("/api/reports/tournament/:tournamentId"));
ok("YouTube authorized URL validation present",/youtube\\.com|youtu\\.be/.test(server));
ok("highlights persistence API present",server.includes("/api/matches/:matchId/highlights"));
ok("admin dashboard API present",server.includes("/api/admin/dashboard"));
ok("backup restore gate remains admin-only",/app\.post\("\/api\/security\/backup", requireAuth, requireAdmin/.test(server));
ok("original UI files remain large/full-size",fs.statSync(path.join(root,"index.html")).size>200000 && fs.statSync(path.join(root,"style.css")).size>200000 && fs.statSync(path.join(root,"script.js")).size>600000);
if(process.env.DATABASE_URL){
  (async()=>{
    try{
      const {getDatabase}=require("./db"); const sql=await getDatabase();
      for(const t of ["users","sessions","otp_codes","profiles","players","teams","tournaments","tournament_teams","tournament_players","matches","match_players","innings","balls","friendships","friend_requests","admins","audit_logs","streams","live_matches","plans","subscriptions","backup_runs"]){
        try{await sql.unsafe(`SELECT 1 FROM ${t} LIMIT 1`);ok("DB table: "+t,true);}
        catch(e){ok("DB table: "+t,false,e.message);}
      }
    }catch(e){ok("DB connection",false,e.message);}
    finish();
  })();
}else finish();
function finish(){
  const failed=tests.filter(x=>!x.pass);
  console.log(JSON.stringify({status:failed.length?"FAIL":"PASS",staticAndConfiguredDbTests:tests.length,failed:failed.length,tests},null,2));
  process.exit(failed.length?1:0);
}
