import { useEffect, useMemo, useState } from "react";
import { io, Socket } from "socket.io-client";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowUpRight, Check, Clock3, Crown, LogOut, Play, Pause, Plus, Radio, Trophy, Users, Zap } from "lucide-react";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";
const SOCKET = import.meta.env.VITE_SOCKET_URL || API;
type Option = { id: string; text: string };
type Question = { id: string; text: string; timeLimitSeconds: number; options: Option[] };
type Leader = { rank: number; name: string; points: number };
type FinalRow = { rank: number; name: string; totalPoints: number; breakdown: number[] };
const socket: Socket = io(SOCKET, { autoConnect: true });

function App() {
  const [page, setPage] = useState<"home"|"login"|"dashboard"|"builder"|"host"|"join"|"play">("home");
  const [token, setToken] = useState(localStorage.getItem("adminToken") || "");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [error, setError] = useState(""); const [quizzes, setQuizzes] = useState<any[]>([]);
  const [title, setTitle] = useState(""); const [description, setDescription] = useState(""); const [basePoints, setBasePoints] = useState(1000);
  const [questions, setQuestions] = useState<any[]>([]); const [qText, setQText] = useState(""); const [seconds, setSeconds] = useState(20);
  const [options, setOptions] = useState(["", "", "", ""]); const [correct, setCorrect] = useState(0); const [explanation, setExplanation] = useState("");
  const [quizId, setQuizId] = useState(""); const [sessionId, setSessionId] = useState(""); const [pin, setPin] = useState("");
  const [name, setName] = useState(""); const [participantToken, setParticipantToken] = useState(localStorage.getItem("participantToken") || "");
  const [participantId, setParticipantId] = useState(""); const [quizTitle, setQuizTitle] = useState("");
  const [activeQ, setActiveQ] = useState<Question|null>(null); const [deadline, setDeadline] = useState(0); const [now, setNow] = useState(Date.now());
  const [selected, setSelected] = useState(""); const [submitted, setSubmitted] = useState(false); const [result, setResult] = useState<any>(null);
  const [topThree, setTopThree] = useState<Leader[]>([]); const [finalRows, setFinalRows] = useState<FinalRow[]>([]);
  const [lobby, setLobby] = useState<{count:number;participants:{id:string;name:string}[]}>({count:0,participants:[]});
  const [progress, setProgress] = useState({answered:0,total:0}); const [status, setStatus] = useState("LOBBY");

  const remaining = Math.max(0, Math.ceil((deadline-now)/1000));
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 200); return () => clearInterval(t); }, []);
  const headers = useMemo(() => ({ "Content-Type":"application/json", ...(token ? {Authorization:`Bearer ${token}`} : {}) }), [token]);
  async function api(path:string, init:RequestInit={}) {
    const r = await fetch(API+path, { ...init, headers:{...headers,...(init.headers||{})} });
    if (!r.ok) { const body=await r.json().catch(()=>({})); throw new Error(body.error || "Request failed"); }
    return r.status===204 ? null : r.json();
  }
  async function login(e:React.FormEvent) { e.preventDefault(); setError(""); try { const d=await api("/api/auth/login",{method:"POST",body:JSON.stringify({email,password})}); setToken(d.token); localStorage.setItem("adminToken",d.token); setPage("dashboard"); } catch(e:any){setError(e.message);} }
  async function loadQuizzes(){try{setQuizzes(await api("/api/quizzes"));}catch(e:any){setError(e.message);}}
  useEffect(()=>{if(token&&page==="dashboard") void loadQuizzes();},[token,page]);
  useEffect(()=>{
    socket.on("join:success",(d)=>{setParticipantId(d.participantId);setParticipantToken(d.participantToken);localStorage.setItem("participantToken",d.participantToken);setQuizTitle(d.quizTitle||"Live quiz");setPage("play");setStatus(d.status);});
    socket.on("join:error",(m)=>setError(String(m)));
    socket.on("question:started",(d)=>{setActiveQ(d.question);setDeadline(new Date(d.deadline).getTime());setSelected("");setSubmitted(false);setResult(null);setTopThree([]);setStatus("ACTIVE");setPage("play");});
    socket.on("answer:accepted",()=>setSubmitted(true));
    socket.on("answer:error",(m)=>setError(String(m)));
    socket.on("participant:result",(d)=>setResult(d));
    socket.on("question:results",(d)=>setTopThree(d.leaderboard||[]));
    socket.on("quiz:paused",()=>setStatus("PAUSED"));
    socket.on("quiz:resumed",(d)=>{setStatus("ACTIVE");setDeadline(new Date(d.deadline).getTime());});
    socket.on("quiz:finished",(d)=>{setFinalRows(d.leaderboard||[]);setStatus("FINISHED");setPage("play");});
    socket.on("lobby:update",(d)=>setLobby(d));
    socket.on("host:progress",(d)=>setProgress(d));
    socket.on("error:message",(m)=>setError(String(m)));
    return ()=>{["join:success","join:error","question:started","answer:accepted","answer:error","participant:result","question:results","quiz:paused","quiz:resumed","quiz:finished","lobby:update","host:progress","error:message"].forEach(ev=>socket.off(ev));};
  },[]);
  async function createQuiz(e:React.FormEvent){e.preventDefault();try{const q=await api("/api/quizzes",{method:"POST",body:JSON.stringify({title,description,basePoints})});setQuizId(q.id);setQuestions([]);setPage("builder");}catch(e:any){setError(e.message);}}
  async function addQuestion(e:React.FormEvent){e.preventDefault();try{const q=await api(`/api/quizzes/${quizId}/questions`,{method:"POST",body:JSON.stringify({text:qText,timeLimitSeconds:seconds,explanation,options:options.filter(x=>x.trim()).map((text,i)=>({text,isCorrect:i===correct}))})});setQuestions([...questions,q]);setQText("");setOptions(["","","",""]);setExplanation("");}catch(e:any){setError(e.message);}}
  async function launch(id:string){try{const s=await api(`/api/quizzes/${id}/sessions`,{method:"POST"});setSessionId(s.id);setPin(s.pin);setQuizId(id);socket.emit("host:join",{sessionId:s.id,token:JSON.parse(atob(token.split(".")[1])).sub});setPage("host");setStatus("LOBBY");}catch(e:any){setError(e.message);}}
  function joinGame(e:React.FormEvent){e.preventDefault();setError("");socket.emit("participant:join",{pin,name});}
  function submitAnswer(){if(!activeQ||!selected||submitted||remaining<=0)return;socket.emit("participant:answer",{participantToken,optionId:selected});}
  function logout(){localStorage.removeItem("adminToken");setToken("");setPage("home");}
  const button=(label:string,onClick:()=>void,kind="primary")=><button className={`button ${kind}`} onClick={onClick}>{label}</button>;

  return <main className="shell">
    <header className="topbar"><button className="brand" onClick={()=>setPage("home")}><span className="brand-mark">q.</span><span>quizroom</span></button><div className="top-actions"><span className="live-dot"/> Built for live learning {token&&<button className="icon-button" onClick={logout} title="Sign out"><LogOut size={17}/></button>}</div></header>
    {error&&<div className="notice" role="alert">{error}<button onClick={()=>setError("")}>×</button></div>}
    <AnimatePresence mode="wait">
    {page==="home"&&<motion.section className="hero" initial={{opacity:0,y:18}} animate={{opacity:1,y:0}} exit={{opacity:0}}>
      <div className="eyebrow"><span/> REAL-TIME KNOWLEDGE, IN GOOD COMPANY</div><h1>Make every<br/><em>answer count.</em></h1><p className="hero-copy">A focused, fast-paced quiz experience for teams, classrooms, and communities. Join a room or host your own.</p>
      <div className="hero-actions">{button("Join a game",()=>setPage("join"))}{button("Host a quiz",()=>setPage(token?"dashboard":"login"),"secondary")}</div>
      <div className="hero-foot"><span><Users size={15}/> Up to 150 players</span><span><Zap size={15}/> Speed-based scoring</span><span><Radio size={15}/> Live synchronization</span></div>
    </motion.section>}
    {page==="login"&&<section className="panel narrow"><div className="eyebrow">HOST ACCESS</div><h2>Welcome back.</h2><p className="muted">Sign in to manage your quizzes and live sessions.</p><form onSubmit={login} className="form"><label>Email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label><label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required/></label><button className="button primary">Sign in <ArrowUpRight size={16}/></button></form></section>}
    {page==="dashboard"&&<section className="content"><div className="section-head"><div><div className="eyebrow">HOST WORKSPACE</div><h2>Your quizzes</h2><p className="muted">Create a quiz, prepare your questions, and launch a live room.</p></div><button className="button primary" onClick={()=>setPage("newquiz")}><Plus size={17}/> Create quiz</button></div><div className="quiz-grid">{quizzes.map(q=><article className="quiz-card" key={q.id}><div className="card-icon"><Radio/></div><h3>{q.title}</h3><p>{q.description||"No description added."}</p><div className="card-meta">{q._count.questions} questions <span>·</span> {q._count.sessions} sessions</div><div className="card-actions"><button className="text-button" onClick={()=>{setQuizId(q.id);setPage("builder");}}>Manage <ArrowUpRight size={14}/></button><button className="button small primary" onClick={()=>void launch(q.id)}>Launch room</button></div></article>)}</div></section>}
    {page==="newquiz"&&<section className="panel narrow"><div className="eyebrow">NEW QUIZ</div><h2>Set the stage.</h2><form className="form" onSubmit={createQuiz}><label>Quiz title<input value={title} onChange={e=>setTitle(e.target.value)} required minLength={2}/></label><label>Description<textarea value={description} onChange={e=>setDescription(e.target.value)}/></label><label>Base points per question<input type="number" min="1" max="10000" value={basePoints} onChange={e=>setBasePoints(Number(e.target.value))}/></label><button className="button primary">Continue <ArrowUpRight size={16}/></button></form></section>}
    {page==="builder"&&<section className="content"><div className="section-head"><div><div className="eyebrow">QUESTION EDITOR</div><h2>Build your quiz.</h2><p className="muted">Every question has its own timer and one correct answer.</p></div><button className="button secondary" onClick={()=>setPage("dashboard")}>Done</button></div><div className="builder-layout"><form className="panel form" onSubmit={addQuestion}><label>Question<textarea value={qText} onChange={e=>setQText(e.target.value)} required/></label><div className="field-row"><label>Time limit (seconds)<input type="number" min="5" max="300" value={seconds} onChange={e=>setSeconds(Number(e.target.value))}/></label><label>Correct option<select value={correct} onChange={e=>setCorrect(Number(e.target.value))}>{options.map((_,i)=><option value={i} key={i}>Option {i+1}</option>)}</select></label></div><div className="options-editor">{options.map((o,i)=><label key={i}>Option {i+1}<input value={o} onChange={e=>setOptions(options.map((v,j)=>j===i?e.target.value:v))} required/></label>)}</div><label>Explanation (optional)<textarea value={explanation} onChange={e=>setExplanation(e.target.value)}/></label><button className="button primary">Add question <Plus size={16}/></button></form><aside className="question-list"><h3>Added questions <span>{questions.length}</span></h3>{questions.map((q,i)=><div className="question-item" key={q.id}><b>{String(i+1).padStart(2,"0")}</b><div>{q.text}<small>{q.timeLimitSeconds}s · {q.options.length} options</small></div></div>)}{!questions.length&&<p className="muted">Your questions will appear here.</p>}</aside></div></section>}
    {page==="join"&&<section className="panel narrow"><div className="eyebrow">PLAYER ENTRY</div><h2>Find your room.</h2><p className="muted">Enter the six-digit game PIN shared by your host.</p><form className="form" onSubmit={joinGame}><label>Game PIN<input className="pin-input" inputMode="numeric" maxLength={6} value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,""))} placeholder="000 000" required/></label><label>Your display name<input value={name} onChange={e=>setName(e.target.value)} maxLength={32} required/></label><button className="button primary">Join game <ArrowUpRight size={16}/></button></form></section>}
    {page==="host"&&<section className="content"><div className="section-head"><div><div className="eyebrow">LIVE SESSION · HOST VIEW</div><h2>Room {pin}</h2><p className="muted">Share this PIN with participants. The room supports up to 150 players.</p></div><div className="status-pill"><span className="live-dot"/>{status.replaceAll("_"," ")}</div></div><div className="host-grid"><div className="panel"><div className="stat"><Users/><strong>{lobby.count}</strong><span>Participants joined</span></div><div className="participant-list">{lobby.participants.map(p=><span key={p.id}>{p.name}</span>)}</div></div><div className="panel host-controls"><h3>Session controls</h3><p className="muted">Answers submitted: {progress.answered} / {progress.total||lobby.count}</p>{status==="LOBBY"&&button("Start quiz",()=>socket.emit("host:start",{sessionId}))}{status==="ACTIVE"&&<>{button("Pause quiz",()=>socket.emit("host:pause",{sessionId}),"secondary")}{button("End quiz",()=>socket.emit("host:end",{sessionId}),"danger")}</>}{status==="PAUSED"&&button("Resume quiz",()=>socket.emit("host:resume",{sessionId}))}{status==="BETWEEN_QUESTIONS"&&button("Next question",()=>socket.emit("host:next",{sessionId}))}{status==="FINISHED"&&<p>Quiz completed. Final results are available to participants.</p>}</div></div></section>}
    {page==="play"&&<section className="play-area">
      {status==="LOBBY"&&<div className="panel narrow center"><div className="eyebrow">YOU'RE IN</div><h2>You're on the list, {name}.</h2><p className="muted">Waiting for the host to start {quizTitle}. Keep this screen open.</p><div className="waiting-indicator"><span/><span/><span/></div></div>}
      {status==="ACTIVE"&&activeQ&&!result&&<motion.div className="question-stage" initial={{opacity:0,y:12}} animate={{opacity:1,y:0}}><div className="question-top"><span className="eyebrow">QUESTION IN PROGRESS</span><div className={`timer ${remaining<=5?"urgent":""}`}><Clock3 size={17}/>{remaining}s</div></div><h2>{activeQ.text}</h2><div className="answer-list">{activeQ.options.map((o,i)=><button key={o.id} disabled={submitted||remaining<=0} className={`answer-option ${selected===o.id?"selected":""}`} onClick={()=>setSelected(o.id)}><span className="option-letter">{String.fromCharCode(65+i)}</span><span>{o.text}</span>{selected===o.id&&<Check size={18}/>}</button>)}</div>{submitted?<p className="submitted"><Check size={16}/> Answer submitted. You're all set.</p>:<button className="button primary submit-answer" disabled={!selected||remaining<=0} onClick={submitAnswer}>Submit answer <ArrowUpRight size={16}/></button>}</motion.div>}
      {result&&<div className="panel narrow center"><div className="result-icon">{result.correct?<Check/>:<Zap/>}</div><div className="eyebrow">QUESTION RESULT</div><h2>{result.correct?"Correct answer.":"Not quite."}</h2><p className="muted">Your points this question</p><div className="score-number">{result.points.toLocaleString()}</div><div className="score-total">Overall score <b>{result.totalPoints.toLocaleString()}</b></div>{topThree.length>0&&<div className="mini-board"><h3><Trophy size={17}/> Fastest correct answers</h3>{topThree.map(x=><div key={x.rank}><span>{x.rank===1?"🥇":x.rank===2?"🥈":"🥉"} {x.name}</span><b>{x.points.toLocaleString()} pts</b></div>)}</div>}<p className="muted small-note">Waiting for the host to continue…</p></div>}
      {status==="BETWEEN_QUESTIONS"&&!result&&<div className="panel narrow center"><div className="eyebrow">QUESTION COMPLETE</div><h2>Nice work.</h2><p className="muted">The host will start the next question shortly.</p>{topThree.length>0&&<div className="mini-board"><h3><Trophy size={17}/> Fastest correct answers</h3>{topThree.map(x=><div key={x.rank}><span>#{x.rank} {x.name}</span><b>{x.points.toLocaleString()} pts</b></div>)}</div>}</div>}
      {status==="PAUSED"&&<div className="panel narrow center"><h2>Quiz paused</h2><p className="muted">The host will resume shortly.</p></div>}
      {status==="FINISHED"&&<div className="panel final-board"><div className="eyebrow">SESSION COMPLETE</div><h2>That's a wrap.</h2><p className="muted">Final overall leaderboard · cumulative points</p><div className="podium">{finalRows.slice(0,3).map((p,i)=><div className={`podium-place place-${p.rank}`} key={p.rank}><Crown/><b>{p.name}</b><strong>{p.totalPoints.toLocaleString()}</strong><small>#{p.rank}</small></div>)}</div><div className="final-list">{finalRows.map(p=><div key={p.rank}><span>#{p.rank}　{p.name}</span><b>{p.totalPoints.toLocaleString()} pts</b></div>)}</div></div>}
    </section>}
    </AnimatePresence>
    <footer><span>QUIZROOM © 2026</span><span>Thoughtful competition. Better learning.</span></footer>
  </main>;
}
export default App;
