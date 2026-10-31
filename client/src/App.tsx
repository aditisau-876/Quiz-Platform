import { useEffect, useMemo, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowUpRight, Check, Clock3, Crown, LogOut, Plus, Radio, Trophy, Users, Zap, Copy, Download, Pencil, Trash2, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

const API = import.meta.env.VITE_API_URL || window.location.origin;
const SOCKET = import.meta.env.VITE_SOCKET_URL || window.location.origin;
type Option = { id: string; text: string };
type Question = { id: string; text: string; timeLimitSeconds: number; options: Option[] };
type Leader = { rank: number; name: string; points: number };
type FinalRow = { rank: number; name: string; totalPoints: number; breakdown: number[] };
const podiumOrder=(rows:FinalRow[])=>[rows[1],rows[0],rows[2]].filter(Boolean) as FinalRow[];
const socket: Socket = io(SOCKET, { autoConnect: true });

function App() {
  const [page, setPage] = useState<"home"|"login"|"dashboard"|"newquiz"|"builder"|"host"|"join"|"play">("home");
  const [token, setToken] = useState(localStorage.getItem("adminToken") || "");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [error, setError] = useState(""); const [quizzes, setQuizzes] = useState<any[]>([]);
  const [title, setTitle] = useState(""); const [description, setDescription] = useState(""); const [basePoints, setBasePoints] = useState(1000);
  const [questions, setQuestions] = useState<any[]>([]); const [qText, setQText] = useState(""); const [seconds, setSeconds] = useState(20);
  const [options, setOptions] = useState(["", "", "", ""]); const [correct, setCorrect] = useState(0); const [explanation, setExplanation] = useState("");
  const [quizId, setQuizId] = useState(""); const [sessionId, setSessionId] = useState("");
  const [pin, setPin] = useState(() => new URLSearchParams(window.location.search).get("pin")?.replace(/\D/g, "").slice(0, 6) || "");
  const [joinUrl, setJoinUrl] = useState("");
  const [name, setName] = useState(""); const [participantToken, setParticipantToken] = useState(localStorage.getItem("participantToken") || "");
  const [participantId, setParticipantId] = useState(""); const [quizTitle, setQuizTitle] = useState("");
  const [activeQ, setActiveQ] = useState<Question|null>(null); const [deadline, setDeadline] = useState(0); const [now, setNow] = useState(Date.now());
  const [selected, setSelected] = useState(""); const [submitted, setSubmitted] = useState(false); const [result, setResult] = useState<any>(null);
  const [topThree, setTopThree] = useState<Leader[]>([]); const [finalRows, setFinalRows] = useState<FinalRow[]>([]);
  const [lobby, setLobby] = useState<{count:number;participants:{id:string;name:string}[]}>({count:0,participants:[]});
  const [progress, setProgress] = useState({answered:0,total:0}); const [status, setStatus] = useState("LOBBY");
  const [qResults, setQResults] = useState<any>(null); const [editingId, setEditingId] = useState(""); const [busy, setBusy] = useState(false);
  const isHost = useRef(false); const hostSession = useRef(""); const tokenRef = useRef(token); const partTokenRef = useRef(participantToken); const inGame = useRef(false);
  tokenRef.current = token;

  useEffect(()=>{ if(page==="host"&&(status==="BETWEEN_QUESTIONS"||status==="FINISHED")) window.scrollTo({top:0,behavior:"smooth"}); },[page,status]);
  const remaining = Math.max(0, Math.ceil((deadline-now)/1000));
  useEffect(() => {
    const incomingPin = new URLSearchParams(window.location.search).get("pin");
    if (incomingPin && /^\d{6}$/.test(incomingPin)) {
      setPin(incomingPin);
      setPage("join");
    }
  }, []);
  useEffect(() => {
    if (pin.length === 6) {
      const url = new URL("/", window.location.origin);
      url.searchParams.set("pin", pin);
      setJoinUrl(url.toString());
    } else {
      setJoinUrl("");
    }
  }, [pin]);
  async function copyJoinLink() {
    if (!joinUrl) return;
    try { await navigator.clipboard.writeText(joinUrl); setError("Join link copied."); }
    catch { setError("Could not copy automatically. You can copy the join link manually."); }
  }
  function downloadJoinQr() {
    const svg = document.getElementById("session-join-qr");
    if (!svg) return;
    const source = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `quizroom-${pin}-qr.svg`; link.click();
    URL.revokeObjectURL(url);
  }
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 200); return () => clearInterval(t); }, []);
  const headers = useMemo(() => ({ "Content-Type":"application/json", ...(token ? {Authorization:`Bearer ${token}`} : {}) }), [token]);
  async function api(path:string, init:RequestInit={}) {
    const r = await fetch(API+path, { ...init, headers:{...headers,...(init.headers||{})} });
    if (!r.ok) { const body=await r.json().catch(()=>({})); if (r.status===401 && tokenRef.current) { logout(); throw new Error("Session expired. Please sign in again."); } throw new Error(body.error || "Request failed"); }
    return r.status===204 ? null : r.json();
  }
  async function login(e:React.FormEvent) { e.preventDefault(); setError(""); try { const d=await api("/api/auth/login",{method:"POST",body:JSON.stringify({email,password})}); setToken(d.token); localStorage.setItem("adminToken",d.token); setPage("dashboard"); } catch(e:any){setError(e.message);} }
  async function loadQuizzes(){try{setQuizzes(await api("/api/quizzes"));}catch(e:any){setError(e.message);}}
  useEffect(()=>{if(token&&page==="dashboard") void loadQuizzes();},[token,page]);
  useEffect(()=>{
    socket.on("connect",()=>{
      // Re-attach to the room after a network drop / server restart.
      if (isHost.current && hostSession.current) socket.emit("host:join",{sessionId:hostSession.current,token:tokenRef.current});
      else if (inGame.current && partTokenRef.current) socket.emit("participant:resume",{participantToken:partTokenRef.current});
    });
    socket.on("host:state",(d)=>{ if (d?.session?.status) setStatus(d.session.status); });
    socket.on("join:success",(d)=>{inGame.current=true;partTokenRef.current=d.participantToken;setParticipantId(d.participantId);setParticipantToken(d.participantToken);localStorage.setItem("participantToken",d.participantToken);if(d.name)setName(d.name);setQuizTitle(d.quizTitle||"Live quiz");setPage("play");setStatus(d.status);setError("");});
    socket.on("join:error",(m)=>setError(String(m)));
    socket.on("question:started",(d)=>{setActiveQ(d.question);setDeadline(new Date(d.deadline).getTime());setSelected("");setSubmitted(false);setResult(null);setTopThree([]);setQResults(null);setProgress(p=>({answered:0,total:p.total}));setStatus("ACTIVE");if(!isHost.current)setPage("play");});
    socket.on("answer:accepted",()=>setSubmitted(true));
    socket.on("answer:error",(m)=>setError(String(m)));
    socket.on("participant:result",(d)=>setResult(d));
    socket.on("question:results",(d)=>{setQResults(d);setTopThree(d.leaderboard||[]);setStatus("BETWEEN_QUESTIONS");});
    socket.on("quiz:paused",()=>setStatus("PAUSED"));
    socket.on("quiz:resumed",(d)=>{setStatus("ACTIVE");setDeadline(new Date(d.deadline).getTime());});
    socket.on("quiz:finished",(d)=>{setFinalRows(d.leaderboard||[]);setStatus("FINISHED");if(!isHost.current)setPage("play");});
    socket.on("lobby:update",(d)=>{setLobby(d);setProgress(p=>({...p,total:d.count}));});
    socket.on("host:progress",(d)=>setProgress(d));
    socket.on("error:message",(m)=>setError(String(m)));
    return ()=>{["connect","host:state","join:success","join:error","question:started","answer:accepted","answer:error","participant:result","question:results","quiz:paused","quiz:resumed","quiz:finished","lobby:update","host:progress","error:message"].forEach(ev=>socket.off(ev));};
  },[]);
  function resetQuestionForm(){setQText("");setOptions(["","","",""]);setCorrect(0);setExplanation("");setSeconds(20);setEditingId("");}
  async function openBuilder(id:string){
    setError("");resetQuestionForm();setQuizId(id);setQuestions([]);
    try{const q=await api(`/api/quizzes/${id}`);setQuestions(q.questions||[]);setTitle(q.title);setPage("builder");}catch(e:any){setError(e.message);}
  }
  async function createQuiz(e:React.FormEvent){e.preventDefault();try{const q=await api("/api/quizzes",{method:"POST",body:JSON.stringify({title,description,basePoints})});setQuizId(q.id);setQuestions([]);resetQuestionForm();setPage("builder");}catch(e:any){setError(e.message);}}
  async function saveQuestion(e:React.FormEvent){
    e.preventDefault();setError("");
    const cleaned=options.map((text,i)=>({text:text.trim(),isCorrect:i===correct})).filter(o=>o.text);
    if(cleaned.length<2){setError("Add at least two answer options.");return;}
    if(!cleaned.some(o=>o.isCorrect)){setError("The correct option cannot be empty.");return;}
    const body=JSON.stringify({text:qText,timeLimitSeconds:seconds,explanation,options:cleaned});
    setBusy(true);
    try{
      if(editingId){const q=await api(`/api/questions/${editingId}`,{method:"PUT",body});setQuestions(questions.map(x=>x.id===editingId?q:x));}
      else{const q=await api(`/api/quizzes/${quizId}/questions`,{method:"POST",body});setQuestions([...questions,q]);}
      resetQuestionForm();
    }catch(e:any){setError(e.message);}finally{setBusy(false);}
  }
  function editQuestion(q:any){
    setError("");setEditingId(q.id);setQText(q.text);setSeconds(q.timeLimitSeconds);setExplanation(q.explanation||"");
    const idx=q.options.findIndex((o:any)=>o.isCorrect);setOptions(q.options.map((o:any)=>o.text));setCorrect(idx<0?0:idx);
    window.scrollTo({top:0,behavior:"smooth"});
  }
  async function deleteQuestion(q:any){
    if(!window.confirm("Delete this question? This cannot be undone."))return;
    try{await api(`/api/questions/${q.id}`,{method:"DELETE"});setQuestions(questions.filter(x=>x.id!==q.id));if(editingId===q.id)resetQuestionForm();}catch(e:any){setError(e.message);}
  }
  async function duplicateQuiz(id:string){try{await api(`/api/quizzes/${id}/duplicate`,{method:"POST"});await loadQuizzes();}catch(e:any){setError(e.message);}}
  async function deleteQuiz(q:any){
    if(!window.confirm(`Delete "${q.title}" with all its questions and past sessions? This cannot be undone.`))return;
    try{await api(`/api/quizzes/${q.id}`,{method:"DELETE"});await loadQuizzes();}catch(e:any){setError(e.message);}
  }
  function setOption(i:number,v:string){setOptions(options.map((o,j)=>j===i?v:o));}
  function addOption(){if(options.length<6)setOptions([...options,""]);}
  function removeOption(i:number){
    if(options.length<=2)return;
    setOptions(options.filter((_,j)=>j!==i));
    setCorrect(c=>i===c?0:(i<c?c-1:c));
  }
  async function launch(id:string){
    try{
      const s=await api(`/api/quizzes/${id}/sessions`,{method:"POST"});
      isHost.current=true;hostSession.current=s.id;
      setSessionId(s.id);setPin(s.pin);setQuizId(id);setLobby({count:0,participants:[]});setProgress({answered:0,total:0});setQResults(null);setActiveQ(null);setFinalRows([]);setTopThree([]);
      socket.emit("host:join",{sessionId:s.id,token});setPage("host");setStatus("LOBBY");
    }catch(e:any){setError(e.message);}
  }
  function leaveHost(){
    if(status!=="FINISHED"){
      if(!window.confirm("Leave this room? The quiz will be ended for everyone."))return;
      socket.emit("host:end",{sessionId});
    }
    isHost.current=false;hostSession.current="";setPage("dashboard");
  }
  function leaveGame(){
    if(status!=="FINISHED"&&!window.confirm("Leave this game?"))return;
    inGame.current=false;partTokenRef.current="";localStorage.removeItem("participantToken");setParticipantToken("");setActiveQ(null);setResult(null);setFinalRows([]);setStatus("LOBBY");
    window.history.replaceState({},"",window.location.pathname);setPage("home");
  }
  function joinGame(e:React.FormEvent){e.preventDefault();setError("");socket.emit("participant:join",{pin,name});}
  function submitAnswer(){if(!activeQ||!selected||submitted||remaining<=0)return;socket.emit("participant:answer",{participantToken,optionId:selected});}
  function logout(){localStorage.removeItem("adminToken");setToken("");tokenRef.current="";isHost.current=false;hostSession.current="";setPage("home");}
  const back=(to:"home"|"dashboard"|"login",label:string)=><button type="button" className="back-link" onClick={()=>{setError("");setPage(to);}}><ArrowLeft size={15}/> {label}</button>;
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
    {page==="login"&&<section className="panel narrow">{back("home","Back")}<div className="eyebrow">HOST ACCESS</div><h2>Welcome back.</h2><p className="muted">Sign in to manage your quizzes and live sessions.</p><form onSubmit={login} className="form"><label>Email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label><label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required/></label><button className="button primary">Sign in <ArrowUpRight size={16}/></button></form></section>}
    {page==="dashboard"&&<section className="content">{back("home","Home")}<div className="section-head"><div><div className="eyebrow">HOST WORKSPACE</div><h2>Your quizzes</h2><p className="muted">Create a quiz, prepare your questions, and launch a live room.</p></div><button className="button primary" onClick={()=>{setTitle("");setDescription("");setBasePoints(1000);setPage("newquiz");}}><Plus size={17}/> Create quiz</button></div><div className="quiz-grid">{quizzes.map(q=><article className="quiz-card" key={q.id}><div className="card-top"><div className="card-icon"><Radio/></div><div className="card-tools"><button className="icon-button" title="Duplicate quiz" onClick={()=>void duplicateQuiz(q.id)}><Copy size={15}/></button><button className="icon-button danger-icon" title="Delete quiz" onClick={()=>void deleteQuiz(q)}><Trash2 size={15}/></button></div></div><h3>{q.title}</h3><p>{q.description||"No description added."}</p><div className="card-meta">{q._count.questions} questions {q.sessions?.[0]?.pin&&<><span>·</span> PIN <b>{q.sessions[0].pin}</b></>}</div><div className="card-actions"><button className="text-button" onClick={()=>void openBuilder(q.id)}>Manage <ArrowUpRight size={14}/></button><button className="button small primary" onClick={()=>void launch(q.id)}>Launch room</button></div></article>)}{!quizzes.length&&<p className="muted">No quizzes yet. Create your first one.</p>}</div></section>}
    {page==="newquiz"&&<section className="panel narrow">{back("dashboard","Back to quizzes")}<div className="eyebrow">NEW QUIZ</div><h2>Set the stage.</h2><form className="form" onSubmit={createQuiz}><label>Quiz title<input value={title} onChange={e=>setTitle(e.target.value)} required minLength={2}/></label><label>Description<textarea value={description} onChange={e=>setDescription(e.target.value)}/></label><label>Base points per question<input type="number" min="1" max="10000" value={basePoints} onChange={e=>setBasePoints(Number(e.target.value))}/></label><button className="button primary">Continue <ArrowUpRight size={16}/></button></form></section>}
    {page==="builder"&&<section className="content">{back("dashboard","Back to quizzes")}<div className="section-head"><div><div className="eyebrow">QUESTION EDITOR</div><h2>Build your quiz.</h2><p className="muted">Every question has its own timer and one correct answer.</p></div><button className="button secondary" onClick={()=>setPage("dashboard")}>Done</button></div><div className="builder-layout"><form className="panel form" onSubmit={saveQuestion}>{editingId&&<div className="edit-banner"><span>Editing question {questions.findIndex(x=>x.id===editingId)+1}</span><button type="button" className="text-button" onClick={resetQuestionForm}><X size={14}/> Cancel edit</button></div>}<label>Question<textarea value={qText} onChange={e=>setQText(e.target.value)} required maxLength={1000}/></label><div className="field-row"><label>Time limit (seconds)<input type="number" min="5" max="300" value={seconds} onChange={e=>setSeconds(Number(e.target.value))}/></label><label>Correct option<select value={correct} onChange={e=>setCorrect(Number(e.target.value))}>{options.map((_,i)=><option value={i} key={i}>Option {i+1}</option>)}</select></label></div><div className="options-editor">{options.map((o,i)=><label key={i}>Option {i+1}{i===correct?" (correct)":""}<span className="option-row"><input value={o} onChange={e=>setOption(i,e.target.value)} required maxLength={300}/>{options.length>2&&<button type="button" className="icon-button" title="Remove option" onClick={()=>removeOption(i)}><X size={14}/></button>}</span></label>)}</div>{options.length<6&&<button type="button" className="text-button" onClick={addOption}><Plus size={14}/> Add option</button>}<label>Explanation (optional)<textarea value={explanation} onChange={e=>setExplanation(e.target.value)} maxLength={2000}/></label><button className="button primary" disabled={busy}>{editingId?"Save changes":"Add question"} {editingId?<Check size={16}/>:<Plus size={16}/>}</button></form><aside className="question-list"><h3>Added questions <span>{questions.length}</span></h3>{questions.map((q,i)=><div className={`question-item ${editingId===q.id?"editing":""}`} key={q.id}><b>{String(i+1).padStart(2,"0")}</b><div className="question-body">{q.text}<small>{q.timeLimitSeconds}s · {q.options.length} options</small></div><div className="question-actions"><button type="button" className="icon-button" title="Edit question" onClick={()=>editQuestion(q)}><Pencil size={14}/></button><button type="button" className="icon-button danger-icon" title="Delete question" onClick={()=>void deleteQuestion(q)}><Trash2 size={14}/></button></div></div>)}{!questions.length&&<p className="muted">Your questions will appear here.</p>}</aside></div></section>}
    {page==="join"&&<section className="panel narrow">{back("home","Back")}<div className="eyebrow">PLAYER ENTRY</div><h2>Find your room.</h2><p className="muted">Enter the six-digit game PIN shared by your host.</p><form className="form" onSubmit={joinGame}><label>Game PIN<input className="pin-input" inputMode="numeric" maxLength={6} value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,""))} placeholder="000 000" required/></label><label>Your display name<input value={name} onChange={e=>setName(e.target.value)} maxLength={32} required/></label><button className="button primary">Join game <ArrowUpRight size={16}/></button></form></section>}
    {page==="host"&&<section className="content"><button type="button" className="back-link" onClick={leaveHost}><ArrowLeft size={15}/> Leave room</button><div className="section-head"><div><div className="eyebrow">LIVE SESSION · HOST VIEW</div><h2>Room {pin}</h2><p className="muted">Share this PIN with participants. The room supports up to 150 players.</p></div><div className="status-pill"><span className="live-dot"/>{status.replaceAll("_"," ")}</div></div>{status==="BETWEEN_QUESTIONS"&&qResults&&<div className="panel host-results"><div className="eyebrow">QUESTION {qResults.questionNumber} OF {qResults.totalQuestions} · RESULTS</div><h3>{qResults.questionText||activeQ?.text}</h3><div className="option-results">{(qResults.options||activeQ?.options||[]).map((o:any,i:number)=>{const n=qResults.optionCounts?.[o.id]||0;const pct=qResults.total?Math.round(n/qResults.total*100):0;const ok=o.id===qResults.correctOptionId;return <div key={o.id} className={`option-result ${ok?"correct":""}`} style={{backgroundSize:`${pct}% 100%`}}><span className="option-letter">{String.fromCharCode(65+i)}</span><span className="or-text">{o.text}</span>{ok&&<Check size={16}/>}<b>{n}</b></div>;})}</div><p className="muted">{qResults.correctCount} of {qResults.total} players answered correctly · {qResults.answered} answered</p>{qResults.explanation&&<p className="muted"><b>Explanation:</b> {qResults.explanation}</p>}<div className="mini-board"><h3><Trophy size={17}/> Fastest correct answers</h3>{topThree.map(x=><div key={x.rank}><span>{x.rank===1?"🥇":x.rank===2?"🥈":"🥉"} {x.name}</span><b>{x.points.toLocaleString()} pts</b></div>)}{!topThree.length&&<p className="muted">Nobody answered correctly.</p>}</div><button className="button primary results-next" onClick={()=>socket.emit("host:next",{sessionId})}>{qResults.isLast?"Show final results":"Next question"} <ArrowUpRight size={16}/></button></div>}{status==="FINISHED"&&<div className="panel final-board host-final"><div className="eyebrow">SESSION COMPLETE</div><h2>Final podium</h2><p className="muted">Overall leaderboard · cumulative points</p><div className="podium">{podiumOrder(finalRows).map(p=><div className={`podium-place place-${p.rank}`} key={p.rank}><Crown/><b>{p.name}</b><strong>{p.totalPoints.toLocaleString()}</strong><small>#{p.rank}</small></div>)}</div><div className="final-list">{finalRows.map(p=><div key={p.rank}><span>#{p.rank}　{p.name}</span><b>{p.totalPoints.toLocaleString()} pts</b></div>)}{!finalRows.length&&<p className="muted">No participants.</p>}</div></div>}<div className="host-grid"><div className="panel"><div className="stat"><Users/><strong>{lobby.count}</strong><span>Participants joined</span></div><div className="participant-list">{lobby.participants.map(p=><span key={p.id}>{p.name}</span>)}</div></div>{status==="LOBBY"&&<div className="panel join-qr-panel"><div className="eyebrow">SCAN TO JOIN</div><h3>Let players scan in.</h3><p className="muted">Scan this QR code with a phone camera to open the join page with the game PIN filled in.</p>{joinUrl&&<div className="join-qr"><QRCodeSVG id="session-join-qr" value={joinUrl} size={190} level="H" includeMargin /></div>}<div className="qr-pin">GAME PIN <strong>{pin}</strong></div><div className="qr-actions"><button className="button secondary" onClick={()=>void copyJoinLink()}><Copy size={15}/> Copy join link</button><button className="button primary" onClick={downloadJoinQr}><Download size={15}/> Download QR</button></div></div>}<div className="panel host-controls"><h3>Session controls</h3>{status==="ACTIVE"&&activeQ&&<div className="host-live"><div className="timer"><Clock3 size={15}/>{remaining}s</div><p>{activeQ.text}</p></div>}<p className="muted">Answers submitted: {progress.answered} / {progress.total||lobby.count}</p>{status==="LOBBY"&&button("Start quiz",()=>socket.emit("host:start",{sessionId}))}{status==="ACTIVE"&&<>{button("Pause quiz",()=>socket.emit("host:pause",{sessionId}),"secondary")}{button("End quiz",()=>socket.emit("host:end",{sessionId}),"danger")}</>}{status==="PAUSED"&&button("Resume quiz",()=>socket.emit("host:resume",{sessionId}))}{status==="BETWEEN_QUESTIONS"&&button(qResults?.isLast?"Show final results":"Next question",()=>socket.emit("host:next",{sessionId}))}{status==="FINISHED"&&<p>Quiz completed.</p>}</div></div></section>}
    {page==="play"&&<section className="play-area"><button type="button" className="back-link leave-game" onClick={leaveGame}><ArrowLeft size={15}/> {status==="FINISHED"?"Home":"Leave game"}</button>
      {status==="LOBBY"&&<div className="panel narrow center"><div className="eyebrow">YOU'RE IN</div><h2>You're on the list, {name}.</h2><p className="muted">Waiting for the host to start {quizTitle}. Keep this screen open.</p><div className="waiting-indicator"><span/><span/><span/></div></div>}
      {status==="ACTIVE"&&activeQ&&!result&&<motion.div className="question-stage" initial={{opacity:0,y:12}} animate={{opacity:1,y:0}}><div className="question-top"><span className="eyebrow">QUESTION IN PROGRESS</span><div className={`timer ${remaining<=5?"urgent":""}`}><Clock3 size={17}/>{remaining}s</div></div><h2>{activeQ.text}</h2><div className="answer-list">{activeQ.options.map((o,i)=><button key={o.id} disabled={submitted||remaining<=0} className={`answer-option ${selected===o.id?"selected":""}`} onClick={()=>setSelected(o.id)}><span className="option-letter">{String.fromCharCode(65+i)}</span><span>{o.text}</span>{selected===o.id&&<Check size={18}/>}</button>)}</div>{submitted?<p className="submitted"><Check size={16}/> Answer submitted. You're all set.</p>:<button className="button primary submit-answer" disabled={!selected||remaining<=0} onClick={submitAnswer}>Submit answer <ArrowUpRight size={16}/></button>}</motion.div>}
      {result&&<div className="panel narrow center"><div className="result-icon">{result.correct?<Check/>:<Zap/>}</div><div className="eyebrow">QUESTION RESULT</div><h2>{result.correct?"Correct answer.":"Not quite."}</h2><p className="muted">Your points this question</p><div className="score-number">{result.points.toLocaleString()}</div><div className="score-total">Overall score <b>{result.totalPoints.toLocaleString()}</b></div>{topThree.length>0&&<div className="mini-board"><h3><Trophy size={17}/> Fastest correct answers</h3>{topThree.map(x=><div key={x.rank}><span>{x.rank===1?"🥇":x.rank===2?"🥈":"🥉"} {x.name}</span><b>{x.points.toLocaleString()} pts</b></div>)}</div>}<p className="muted small-note">Waiting for the host to continue…</p></div>}
      {status==="BETWEEN_QUESTIONS"&&!result&&<div className="panel narrow center"><div className="eyebrow">QUESTION COMPLETE</div><h2>Nice work.</h2><p className="muted">The host will start the next question shortly.</p>{topThree.length>0&&<div className="mini-board"><h3><Trophy size={17}/> Fastest correct answers</h3>{topThree.map(x=><div key={x.rank}><span>#{x.rank} {x.name}</span><b>{x.points.toLocaleString()} pts</b></div>)}</div>}</div>}
      {status==="PAUSED"&&<div className="panel narrow center"><h2>Quiz paused</h2><p className="muted">The host will resume shortly.</p></div>}
      {status==="FINISHED"&&<div className="panel final-board"><div className="eyebrow">SESSION COMPLETE</div><h2>That's a wrap.</h2><p className="muted">Final overall leaderboard · cumulative points</p><div className="podium">{podiumOrder(finalRows).map(p=><div className={`podium-place place-${p.rank}`} key={p.rank}><Crown/><b>{p.name}</b><strong>{p.totalPoints.toLocaleString()}</strong><small>#{p.rank}</small></div>)}</div><div className="final-list">{finalRows.map(p=><div key={p.rank}><span>#{p.rank}　{p.name}</span><b>{p.totalPoints.toLocaleString()} pts</b></div>)}</div></div>}
    </section>}
    </AnimatePresence>
    <footer><span>QUIZROOM © 2026</span><span>Thoughtful competition. Better learning.</span></footer>
  </main>;
}
export default App;
