import React, { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  useDroppable,
  useDraggable,
  PointerSensor,
  useSensors,
  useSensor,
  DragOverlay,
  closestCorners,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { initializeApp } from "firebase/app";
import {
  getFirestore,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import { getAuth, onAuthStateChanged, signInAnonymously } from "firebase/auth";

/* ================= Firebase ================= */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyC4Q_qgs-bXtWHhSyQRAS3CJr1NxkY04m0",
  authDomain: "uteq-lab-horarios.firebaseapp.com",
  projectId: "uteq-lab-horarios",
  storageBucket: "uteq-lab-horarios.firebasestorage.app",
  messagingSenderId: "248562477461",
  appId: "1:248562477461:web:96c0ec509da12cc8f8ae9c",
};
const app = initializeApp(FIREBASE_CONFIG);
const db = getFirestore(app);
const auth = getAuth(app);

/* ================= Constantes de horario ================= */
const LAB_ID = "lab-computo-uteq";
const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie"] as const;
type Dia = typeof DIAS[number];

const SLOT_MIN = 60;    // bloque fijo de 60 minutos
const SLOT_PX = 88;     // altura visual de cada fila
const HORA_INICIO = "07:30";
const HORA_FIN = "17:30";
const WEEKS = Array.from({ length: 18 }, (_, i) => i + 1);

function hhmmToMinutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
function minutesToHHMM(mins: number) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const pad = (x: number) => (x < 10 ? `0${x}` : `${x}`);
  return `${pad(h)}:${pad(m)}`;
}
function buildSlots() {
  const out: string[] = [];
  for (let t = hhmmToMinutes(HORA_INICIO); t < hhmmToMinutes(HORA_FIN); t += SLOT_MIN) {
    out.push(minutesToHHMM(t));
  }
  return out; // ["07:30","08:30",...,"16:30"]
}
const SLOTS = buildSlots();
const TIME_LABELS = [...SLOTS, HORA_FIN];

/* ================= Tipos ================= */
type Assignment = {
  id: string;
  subject: string;
  sp: string;        // Semestre - Paralelo
  docente: string;
  dia: Dia;
  startSlotIndex: number; // índice de SLOTS
  durationSlots: number;  // compatibilidad (ahora siempre 1)
  color?: string;
  uid: string;
  updatedAt?: any;
};
type ScheduleDoc = {
  slots?: Record<string, string>;         // key `${dia}|${slotIdx}` => assignmentId
  assignments?: Record<string, Assignment>;
};
type CourseOption = { id: string; subject: string; sp: string; docente: string };

/* ================= Catálogo completo ================= */
const COURSES: CourseOption[] = [
  { docente: "ACOSTA MANOSALVAS JORGE JAVIER", subject: "MOTORES DE COMBUSTION INTERNA", sp: "8A", id: "MOTORES DE COMBUSTION INTERNA|8A|ACOSTA MANOSALVAS JORGE JAVIER" },
  { docente: "ACOSTA MANOSALVAS JORGE JAVIER", subject: "TERMODINÁMICA", sp: "5A", id: "TERMODINÁMICA|5A|ACOSTA MANOSALVAS JORGE JAVIER" },
  { docente: "ACOSTA MANOSALVAS JORGE JAVIER", subject: "TERMODINÁMICA Y ONDAS MECÁNICAS", sp: "2A", id: "TERMODINÁMICA Y ONDAS MECÁNICAS|2A|ACOSTA MANOSALVAS JORGE JAVIER" },
  { docente: "ACOSTA MANOSALVAS JORGE JAVIER", subject: "TURBOMAQUINARIA", sp: "9A", id: "TURBOMAQUINARIA|9A|ACOSTA MANOSALVAS JORGE JAVIER" },

  { docente: "ALCOCER QUINTEROS RUBEN PATRICIO", subject: "CÁLCULO DIFERENCIAL", sp: "1A", id: "CÁLCULO DIFERENCIAL|1A|ALCOCER QUINTEROS RUBEN PATRICIO" },
  { docente: "ALCOCER QUINTEROS RUBEN PATRICIO", subject: "CÁLCULO DIFERENCIAL", sp: "1B", id: "CÁLCULO DIFERENCIAL|1B|ALCOCER QUINTEROS RUBEN PATRICIO" },

  { docente: "ALMEIDA MURILLO WILMER FABRICIO", subject: "ÁLGEBRA LINEAL", sp: "1A", id: "ÁLGEBRA LINEAL|1A|ALMEIDA MURILLO WILMER FABRICIO" },
  { docente: "ALMEIDA MURILLO WILMER FABRICIO", subject: "ÁLGEBRA LINEAL", sp: "1B", id: "ÁLGEBRA LINEAL|1B|ALMEIDA MURILLO WILMER FABRICIO" },

  { docente: "ARELLANO ORTIZ GABRIEL ALEJANDRO", subject: "CIENCIA DE LOS MATERIALES", sp: "4A", id: "CIENCIA DE LOS MATERIALES|4A|ARELLANO ORTIZ GABRIEL ALEJANDRO" },
  { docente: "ARELLANO ORTIZ GABRIEL ALEJANDRO", subject: "CORROSIÓN Y FALLA", sp: "6A", id: "CORROSIÓN Y FALLA|6A|ARELLANO ORTIZ GABRIEL ALEJANDRO" },
  { docente: "ARELLANO ORTIZ GABRIEL ALEJANDRO", subject: "DESARROLLO DE TITULACIÓN I", sp: "9A", id: "DESARROLLO DE TITULACIÓN I|9A|ARELLANO ORTIZ GABRIEL ALEJANDRO" },
  { docente: "ARELLANO ORTIZ GABRIEL ALEJANDRO", subject: "MATERIALES DE INGENIERÍA", sp: "5A", id: "MATERIALES DE INGENIERÍA|5A|ARELLANO ORTIZ GABRIEL ALEJANDRO" },
  { docente: "ARELLANO ORTIZ GABRIEL ALEJANDRO", subject: "TRATAMIENTOS TÉRMICOS Y SUPERFICIALES", sp: "7A", id: "TRATAMIENTOS TÉRMICOS Y SUPERFICIALES|7A|ARELLANO ORTIZ GABRIEL ALEJANDRO" },

  { docente: "CALVOPIÑA COELLO KARYNA MICHEL", subject: "QUÍMICA GENERAL", sp: "1A", id: "QUÍMICA GENERAL|1A|CALVOPIÑA COELLO KARYNA MICHEL" },
  { docente: "CALVOPIÑA COELLO KARYNA MICHEL", subject: "REDACCIÓN TÉCNICA", sp: "1A", id: "REDACCIÓN TÉCNICA|1A|CALVOPIÑA COELLO KARYNA MICHEL" },

  { docente: "CEVALLOS MUÑOZ OMAR ARTURO", subject: "CÁLCULO INTEGRAL", sp: "2A", id: "CÁLCULO INTEGRAL|2A|CEVALLOS MUÑOZ OMAR ARTURO" },
  { docente: "CEVALLOS MUÑOZ OMAR ARTURO", subject: "ECUACIONES DIFERENCIALES", sp: "3A", id: "ECUACIONES DIFERENCIALES|3A|CEVALLOS MUÑOZ OMAR ARTURO" },
  { docente: "CEVALLOS MUÑOZ OMAR ARTURO", subject: "ECUACIONES DIFERENCIALES", sp: "3B", id: "ECUACIONES DIFERENCIALES|3B|CEVALLOS MUÑOZ OMAR ARTURO" },
  { docente: "CEVALLOS MUÑOZ OMAR ARTURO", subject: "FORMULACIÓN Y EVALUACIÓN DE PROYECTOS", sp: "10A", id: "FORMULACIÓN Y EVALUACIÓN DE PROYECTOS|10A|CEVALLOS MUÑOZ OMAR ARTURO" },
  { docente: "CEVALLOS MUÑOZ OMAR ARTURO", subject: "MÉTODOS NUMÉRICOS", sp: "4A", id: "MÉTODOS NUMÉRICOS|4A|CEVALLOS MUÑOZ OMAR ARTURO" },

  { docente: "CULCAY VELIZ MARIASOL BELEN", subject: "CONTABILIDAD DE COSTOS", sp: "4A", id: "CONTABILIDAD DE COSTOS|4A|CULCAY VELIZ MARIASOL BELEN" },
  { docente: "CULCAY VELIZ MARIASOL BELEN", subject: "EMPRENDIMIENTO", sp: "9A", id: "EMPRENDIMIENTO|9A|CULCAY VELIZ MARIASOL BELEN" },
  { docente: "CULCAY VELIZ MARIASOL BELEN", subject: "INGENIERÍA ECONÓMICA", sp: "6A", id: "INGENIERÍA ECONÓMICA|6A|CULCAY VELIZ MARIASOL BELEN" },
  { docente: "CULCAY VELIZ MARIASOL BELEN", subject: "REDACCIÓN TÉCNICA", sp: "1B", id: "REDACCIÓN TÉCNICA|1B|CULCAY VELIZ MARIASOL BELEN" },

  { docente: "DELGADO REVILLA ALBERTO RICARDO", subject: "ELECTROTECNIA", sp: "4A", id: "ELECTROTECNIA|4A|DELGADO REVILLA ALBERTO RICARDO" },

  { docente: "GARCIA COX WALTER OSCAR", subject: "ECOLOGÍA, SABERES ANCESTRALES E IMPACTO AMBIENTAL", sp: "9A", id: "ECOLOGÍA, SABERES ANCESTRALES E IMPACTO AMBIENTAL|9A|GARCIA COX WALTER OSCAR" },

  { docente: "GUAMAN RIVERA FERNANDA RAQUEL", subject: "INGLES VI", sp: "6A", id: "INGLES VI|6A|GUAMAN RIVERA FERNANDA RAQUEL" },

  { docente: "GUERRERO GOYES KENYA ANMARIT", subject: "FUNDAMENTOS DE COMPUTACIÓN", sp: "1A", id: "FUNDAMENTOS DE COMPUTACIÓN|1A|GUERRERO GOYES KENYA ANMARIT" },
  { docente: "GUERRERO GOYES KENYA ANMARIT", subject: "FUNDAMENTOS DE COMPUTACIÓN", sp: "1B", id: "FUNDAMENTOS DE COMPUTACIÓN|1B|GUERRERO GOYES KENYA ANMARIT" },

  { docente: "HERRERA CONTRERAS HERNAN DARIO", subject: "INGENIERÍA DE MANTENIMIENTO", sp: "9A", id: "INGENIERÍA DE MANTENIMIENTO|9A|HERRERA CONTRERAS HERNAN DARIO" },
  { docente: "HERRERA CONTRERAS HERNAN DARIO", subject: "METROLOGÍA E INSTRUMENTACIÓN", sp: "3A", id: "METROLOGÍA E INSTRUMENTACIÓN|3A|HERRERA CONTRERAS HERNAN DARIO" },
  { docente: "HERRERA CONTRERAS HERNAN DARIO", subject: "METROLOGÍA E INSTRUMENTACIÓN", sp: "3B", id: "METROLOGÍA E INSTRUMENTACIÓN|3B|HERRERA CONTRERAS HERNAN DARIO" },
  { docente: "HERRERA CONTRERAS HERNAN DARIO", subject: "SISTEMAS DE MANUFACTURA E INGENIERÍA", sp: "7A", id: "SISTEMAS DE MANUFACTURA E INGENIERÍA|7A|HERRERA CONTRERAS HERNAN DARIO" },
  { docente: "HERRERA CONTRERAS HERNAN DARIO", subject: "TALLER MECÁNICO", sp: "2A", id: "TALLER MECÁNICO|2A|HERRERA CONTRERAS HERNAN DARIO" },

  { docente: "LOPEZ PEREZ VERONICA PAULINA", subject: "ÉTICA PROFESIONAL", sp: "9A", id: "ÉTICA PROFESIONAL|9A|LOPEZ PEREZ VERONICA PAULINA" },

  { docente: "MONGE GARCIA GUSTAVO VINICIO", subject: "CÁLCULO VECTORIAL", sp: "3A", id: "CÁLCULO VECTORIAL|3A|MONGE GARCIA GUSTAVO VINICIO" },
  { docente: "MONGE GARCIA GUSTAVO VINICIO", subject: "CÁLCULO VECTORIAL", sp: "3B", id: "CÁLCULO VECTORIAL|3B|MONGE GARCIA GUSTAVO VINICIO" },

  { docente: "MORAN CABEZAS ANTHONY  LIMBER", subject: "ELECTRONICA", sp: "5A", id: "ELECTRONICA|5A|MORAN CABEZAS ANTHONY  LIMBER" },

  { docente: "PACHACAMA NASIMBA VICTOR PATRICIO", subject: "PROCESOS DE CONVECCIÓN E INTERCAMBIADORES DE CALOR", sp: "8A", id: "PROCESOS DE CONVECCIÓN E INTERCAMBIADORES DE CALOR|8A|PACHACAMA NASIMBA VICTOR PATRICIO" },
  { docente: "PACHACAMA NASIMBA VICTOR PATRICIO", subject: "SISTEMAS ENERGÉTICOS", sp: "10A", id: "SISTEMAS ENERGÉTICOS|10A|PACHACAMA NASIMBA VICTOR PATRICIO" },
  { docente: "PACHACAMA NASIMBA VICTOR PATRICIO", subject: "TERMODINAMICA APLICADA", sp: "6A", id: "TERMODINAMICA APLICADA|6A|PACHACAMA NASIMBA VICTOR PATRICIO" },
  { docente: "PACHACAMA NASIMBA VICTOR PATRICIO", subject: "TRANSFERENCIA DE CALOR", sp: "7A", id: "TRANSFERENCIA DE CALOR|7A|PACHACAMA NASIMBA VICTOR PATRICIO" },

  { docente: "PEREZ SIGCHA EVELYN AMANDA", subject: "INGLES I", sp: "1A", id: "INGLES I|1A|PEREZ SIGCHA EVELYN AMANDA" },
  { docente: "PEREZ SIGCHA EVELYN AMANDA", subject: "INGLES I", sp: "1B", id: "INGLES I|1B|PEREZ SIGCHA EVELYN AMANDA" },
  { docente: "PEREZ SIGCHA EVELYN AMANDA", subject: "INGLES II", sp: "2A", id: "INGLES II|2A|PEREZ SIGCHA EVELYN AMANDA" },
  { docente: "PEREZ SIGCHA EVELYN AMANDA", subject: "INGLES III", sp: "3A", id: "INGLES III|3A|PEREZ SIGCHA EVELYN AMANDA" },
  { docente: "PEREZ SIGCHA EVELYN AMANDA", subject: "INGLES III", sp: "3B", id: "INGLES III|3B|PEREZ SIGCHA EVELYN AMANDA" },
  { docente: "PEREZ SIGCHA EVELYN AMANDA", subject: "INGLES IV", sp: "4A", id: "INGLES IV|4A|PEREZ SIGCHA EVELYN AMANDA" },
  { docente: "PEREZ SIGCHA EVELYN AMANDA", subject: "INGLES V", sp: "5A", id: "INGLES V|5A|PEREZ SIGCHA EVELYN AMANDA" },

  { docente: "PRIETO BENAVIDES OSCAR OSWALDO", subject: "PROBABILIDADES Y ESTADÍSTICA", sp: "3A", id: "PROBABILIDADES Y ESTADÍSTICA|3A|PRIETO BENAVIDES OSCAR OSWALDO" },
  { docente: "PRIETO BENAVIDES OSCAR OSWALDO", subject: "PROBABILIDADES Y ESTADÍSTICA", sp: "3B", id: "PROBABILIDADES Y ESTADÍSTICA|3B|PRIETO BENAVIDES OSCAR OSWALDO" },

  { docente: "RAMIREZ MONTESDEOCA WILSON ANDRES", subject: "DINAMICA DE FLUIDOS", sp: "5A", id: "DINAMICA DE FLUIDOS|5A|RAMIREZ MONTESDEOCA WILSON ANDRES" },
  { docente: "RAMIREZ MONTESDEOCA WILSON ANDRES", subject: "DINAMICA DE SISTEMAS", sp: "6A", id: "DINAMICA DE SISTEMAS|6A|RAMIREZ MONTESDEOCA WILSON ANDRES" },
  { docente: "RAMIREZ MONTESDEOCA WILSON ANDRES", subject: "ELEMENTOS DE MÁQUINAS", sp: "7A", id: "ELEMENTOS DE MÁQUINAS|7A|RAMIREZ MONTESDEOCA WILSON ANDRES" },
  { docente: "RAMIREZ MONTESDEOCA WILSON ANDRES", subject: "ESTRUCTURAS METÁLICAS", sp: "8A", id: "ESTRUCTURAS METÁLICAS|8A|RAMIREZ MONTESDEOCA WILSON ANDRES" },
  { docente: "RAMIREZ MONTESDEOCA WILSON ANDRES", subject: "MECÁNICA DE FLUIDOS", sp: "4A", id: "MECÁNICA DE FLUIDOS|4A|RAMIREZ MONTESDEOCA WILSON ANDRES" },

  { docente: "SALAZAR LOOR RODGER BENJAMIN", subject: "DISEÑO MECÁNICO", sp: "8A", id: "DISEÑO MECÁNICO|8A|SALAZAR LOOR RODGER BENJAMIN" },
  { docente: "SALAZAR LOOR RODGER BENJAMIN", subject: "MECÁNICA DE LOS MATERIALES AVANZADA", sp: "6A", id: "MECÁNICA DE LOS MATERIALES AVANZADA|6A|SALAZAR LOOR RODGER BENJAMIN" },
  { docente: "SALAZAR LOOR RODGER BENJAMIN", subject: "MECÁNICA DE LOS MATERIALES BÁSICA", sp: "5A", id: "MECÁNICA DE LOS MATERIALES BÁSICA|5A|SALAZAR LOOR RODGER BENJAMIN" },
  { docente: "SALAZAR LOOR RODGER BENJAMIN", subject: "NEUMATICA E HIDRAULICA", sp: "7A", id: "NEUMATICA E HIDRAULICA|7A|SALAZAR LOOR RODGER BENJAMIN" },

  { docente: "TAIPE QUILLIGANA SILVIA VIRGINIA", subject: "MÁQUINAS ELÉCTRICAS", sp: "5A", id: "MÁQUINAS ELÉCTRICAS|5A|TAIPE QUILLIGANA SILVIA VIRGINIA" },

  { docente: "TAY HING CAJAS CECILIA CAROLINA", subject: "QUÍMICA GENERAL", sp: "1B", id: "QUÍMICA GENERAL|1B|TAY HING CAJAS CECILIA CAROLINA" },

  { docente: "TOPA CHUQUITARCO CRISTIAN PAUL", subject: "DESARROLLO DE TITULACIÓN II", sp: "10A", id: "DESARROLLO DE TITULACIÓN II|10A|TOPA CHUQUITARCO CRISTIAN PAUL" },
  { docente: "TOPA CHUQUITARCO CRISTIAN PAUL", subject: "ELECTRICIDAD Y MAGNETISMO", sp: "3A", id: "ELECTRICIDAD Y MAGNETISMO|3A|TOPA CHUQUITARCO CRISTIAN PAUL" },
  { docente: "TOPA CHUQUITARCO CRISTIAN PAUL", subject: "MECANISMOS", sp: "6A", id: "MECANISMOS|6A|TOPA CHUQUITARCO CRISTIAN PAUL" },
  { docente: "TOPA CHUQUITARCO CRISTIAN PAUL", subject: "PROCESOS INDUSTRIALES", sp: "8A", id: "PROCESOS INDUSTRIALES|8A|TOPA CHUQUITARCO CRISTIAN PAUL" },
  { docente: "TOPA CHUQUITARCO CRISTIAN PAUL", subject: "SISTEMAS DE GESTIÓN DE LA CALIDAD Y SEGURIDAD INDUSTRIAL", sp: "10A", id: "SISTEMAS DE GESTIÓN DE LA CALIDAD Y SEGURIDAD INDUSTRIAL|10A|TOPA CHUQUITARCO CRISTIAN PAUL" },

  { docente: "TUBAY VERGARA JOSE LUIS", subject: "PROGRAMACIÓN", sp: "2A", id: "PROGRAMACIÓN|2A|TUBAY VERGARA JOSE LUIS" },

  { docente: "VLASSOVA  LIDIA", subject: "METODOLOGÍA DE LA INVESTIGACIÓN", sp: "2A", id: "METODOLOGÍA DE LA INVESTIGACIÓN|2A|VLASSOVA  LIDIA" },

  { docente: "ZAMORA HERNANDEZ YUSIMIT KARINA", subject: "DIBUJO MECÁNICO", sp: "2A", id: "DIBUJO MECÁNICO|2A|ZAMORA HERNANDEZ YUSIMIT KARINA" },
  { docente: "ZAMORA HERNANDEZ YUSIMIT KARINA", subject: "DINÁMICA", sp: "4A", id: "DINÁMICA|4A|ZAMORA HERNANDEZ YUSIMIT KARINA" },
  { docente: "ZAMORA HERNANDEZ YUSIMIT KARINA", subject: "ESTÁTICA", sp: "3A", id: "ESTÁTICA|3A|ZAMORA HERNANDEZ YUSIMIT KARINA" },
  { docente: "ZAMORA HERNANDEZ YUSIMIT KARINA", subject: "ESTÁTICA", sp: "3B", id: "ESTÁTICA|3B|ZAMORA HERNANDEZ YUSIMIT KARINA" },
  { docente: "ZAMORA HERNANDEZ YUSIMIT KARINA", subject: "FÍSICA", sp: "1A", id: "FÍSICA|1A|ZAMORA HERNANDEZ YUSIMIT KARINA" },

  { docente: "ZZZ_FCI_1  X", subject: "ELECTRICIDAD Y MAGNETISMO", sp: "3B", id: "ELECTRICIDAD Y MAGNETISMO|3B|ZZZ_FCI_1  X" },
  { docente: "ZZZ_FCI_1  X", subject: "FÍSICA", sp: "1B", id: "FÍSICA|1B|ZZZ_FCI_1  X" },
];

/* ================= Helpers UI ================= */
function colorForSubject(name: string) {
  const colors = [
    "bg-blue-100 text-blue-800",
    "bg-emerald-100 text-emerald-800",
    "bg-amber-100 text-amber-800",
    "bg-fuchsia-100 text-fuchsia-800",
    "bg-cyan-100 text-cyan-800",
    "bg-rose-100 text-rose-800",
  ];
  const idx =
    Math.abs(name.split("").reduce((a, c) => a + c.charCodeAt(0), 0)) %
    colors.length;
  return colors[idx];
}

function DropCell({ id, children }: { id: string; children?: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ height: SLOT_PX }}
      className={`relative border border-gray-200 hover:bg-gray-50 ${isOver ? "ring-2 ring-blue-400" : ""}`}
    >
      {children}
    </div>
  );
}

function DraggableCard({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id });
  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.85 : 1,
    zIndex: isDragging ? 50 : 1,
  } as React.CSSProperties;
  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes} className="cursor-grab active:cursor-grabbing">
      {children}
    </div>
  );
}

function CoursePicker({
  value,
  setValue,
}: {
  value: string;
  setValue: (v: string) => void;
}) {
  return (
    <select
      className="border rounded-lg px-3 py-2 text-sm w-[560px]"
      value={value}
      onChange={(e) => setValue(e.target.value)}
    >
      <option value="">— Selecciona —</option>
      {COURSES.map((o) => (
        <option key={o.id} value={o.id}>
          {o.subject} · {o.sp} · {o.docente}
        </option>
      ))}
    </select>
  );
}

/* ================= App ================= */
export default function UTQScheduler() {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const [uid, setUid] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const [currentWeek, setCurrentWeek] = useState<number>(1);
  const scheduleRef = useMemo(
    () => doc(db, "schedules", `${LAB_ID}-w${String(currentWeek).padStart(2, "0")}`),
    [currentWeek]
  );

  const [schedule, setSchedule] = useState<ScheduleDoc>({ assignments: {}, slots: {} });
  const assignments = schedule.assignments || {};
  const slotsMap = schedule.slots || {};
  const slotKey = (dia: Dia, idx: number) => `${dia}|${idx}`;

  const [selectedCourseId, setSelectedCourseId] = useState<string>("");

  /* Auth anónima */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) setUid(u.uid);
      else signInAnonymously(auth).catch(console.error);
    });
    return () => unsub();
  }, []);

  /* Suscripción a Firestore */
  useEffect(() => {
    const unsub = onSnapshot(scheduleRef, (snap) => {
      const data = (snap.data() as ScheduleDoc) || { assignments: {}, slots: {} };
      setSchedule({ assignments: data.assignments || {}, slots: data.slots || {} });
    });
    return () => unsub();
  }, [scheduleRef]);

  function getSelectedCourse(): CourseOption | null {
    if (!selectedCourseId) return null;
    return COURSES.find((c) => c.id === selectedCourseId) || null;
  }

  /* ===== Crear nuevo ===== */
  async function placeAssignment(dia: Dia, startSlotIndex: number) {
    const course = getSelectedCourse();
    if (!course) return alert("Selecciona primero una asignatura");
    setBusy(true);
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(scheduleRef);
        const data = (snap.data() as ScheduleDoc) || { slots: {}, assignments: {} };
        const slots = { ...(data.slots || {}) } as Record<string, string>;
        const asigs = { ...(data.assignments || {}) } as Record<string, Assignment>;

        // Limpieza de basura: si un slot apunta a un id inexistente, límpialo
        const dur = 1;
        for (let i = 0; i < dur; i++) {
          const k = slotKey(dia, startSlotIndex + i);
          const occ = slots[k];
          if (occ && !asigs[occ]) delete slots[k];
        }

        if (startSlotIndex < 0 || startSlotIndex + dur > SLOTS.length)
          throw new Error("Fuera de horario");
        for (let i = 0; i < dur; i++) {
          const k = slotKey(dia, startSlotIndex + i);
          if (slots[k]) throw new Error("Ese casillero ya está ocupado");
        }

        const id = `a_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const asg: Assignment = {
          id,
          subject: course.subject,
          sp: course.sp,
          docente: course.docente,
          dia,
          startSlotIndex,
          durationSlots: 1,
          color: colorForSubject(course.subject),
          uid,
          updatedAt: serverTimestamp(),
        };

        for (let i = 0; i < dur; i++) slots[slotKey(dia, startSlotIndex + i)] = id;
        asigs[id] = asg;

        tx.set(scheduleRef, { slots, assignments: asigs }, { merge: true });
      });
      setSelectedCourseId("");
    } catch (e: any) {
      alert(e.message || "No se pudo asignar");
    } finally {
      setBusy(false);
    }
  }

  /* ===== Mover existente (normaliza a 60min y limpia viejos slots) ===== */
  async function moveAssignment(id: string, dia: Dia, startSlotIndex: number) {
    setBusy(true);
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(scheduleRef);
        const data = (snap.data() as ScheduleDoc) || { slots: {}, assignments: {} };
        const slots = { ...(data.slots || {}) } as Record<string, string>;
        const asigs = { ...(data.assignments || {}) } as Record<string, Assignment>;

        const current = asigs[id];
        if (!current) throw new Error("No existe la asignación");

        // Libera TODO lo antiguo (por si tenía duración > 1)
        const oldDur = current.durationSlots || 1;
        for (let i = 0; i < oldDur; i++) {
          const k = slotKey(current.dia, current.startSlotIndex + i);
          if (slots[k] === id) delete slots[k];
        }

        // Limpieza de basura en destino
        const dur = 1;
        for (let i = 0; i < dur; i++) {
          const k = slotKey(dia, startSlotIndex + i);
          const occ = slots[k];
          if (occ && !asigs[occ]) delete slots[k];
        }

        if (startSlotIndex < 0 || startSlotIndex + dur > SLOTS.length)
          throw new Error("Fuera de horario");
        for (let i = 0; i < dur; i++) {
          const k = slotKey(dia, startSlotIndex + i);
          const occ = slots[k];
          if (occ && occ !== id) throw new Error("Choque con otra asignatura");
        }

        for (let i = 0; i < dur; i++) slots[slotKey(dia, startSlotIndex + i)] = id;

        asigs[id] = {
          ...current,
          dia,
          startSlotIndex,
          durationSlots: 1, // normalizado
          uid,
          updatedAt: serverTimestamp(),
        };

        tx.set(scheduleRef, { slots, assignments: asigs }, { merge: true });
      });
    } catch (e: any) {
      alert(e.message || "No se pudo mover");
    } finally {
      setBusy(false);
    }
  }

  /* ===== Eliminar (click derecho) ===== */
  async function deleteAssignment(id: string) {
    setBusy(true);
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(scheduleRef);
        const data = (snap.data() as ScheduleDoc) || { slots: {}, assignments: {} };
        const slots = { ...(data.slots || {}) } as Record<string, string>;
        const asigs = { ...(data.assignments || {}) } as Record<string, Assignment>;

        const current = asigs[id];
        if (!current) return;

        for (let i = 0; i < (current.durationSlots || 1); i++) {
          const k = slotKey(current.dia, current.startSlotIndex + i);
          if (slots[k] === id) delete slots[k];
        }
        delete asigs[id];

        tx.set(scheduleRef, { slots, assignments: asigs }, { merge: true });
      });
    } catch (e: any) {
      alert(e.message || "No se pudo eliminar");
    } finally {
      setBusy(false);
    }
  }

  /* ===== UI: Tarjeta ===== */
  function AssignmentCard({ a }: { a: Assignment }) {
    return (
      <DraggableCard id={a.id}>
        <div
          className={`relative m-1 rounded-xl px-3 py-2 shadow-sm border ${a.color || "bg-blue-100 text-blue-800"}`}
          style={{ height: SLOT_PX }}
          onContextMenu={(e) => {
            e.preventDefault();
            deleteAssignment(a.id);
          }}
          title="Click izquierdo: arrastrar · Click derecho: eliminar"
        >
          <div className="text-center leading-tight break-words">
            <div className="text-[12px] font-semibold">{a.subject}</div>
            <div className="text-[11px] opacity-80">{a.sp}</div>
            <div className="text-[11px] font-medium">{a.docente}</div>
          </div>
        </div>
      </DraggableCard>
    );
  }

  /* Tarjeta “nueva” (drag desde selector) */
  function NewCardPreview() {
    const course = getSelectedCourse();
    if (!course)
      return <div className="text-xs text-gray-400">Selecciona una asignatura para activar el bloque</div>;
    return (
      <DraggableCard id="__new__">
        <div
          className={`${colorForSubject(course.subject)} m-1 rounded-xl px-3 py-2 shadow-sm border`}
          style={{ height: SLOT_PX }}
          title="Arrastra a la grilla"
        >
          <div className="text-center leading-tight">
            <div className="text-[12px] font-semibold">{course.subject}</div>
            <div className="text-[11px] opacity-80">{course.sp}</div>
            <div className="text-[11px] font-medium">{course.docente}</div>
          </div>
        </div>
      </DraggableCard>
    );
  }

  /* ===== UI: Grilla ===== */
  function Grid() {
    return (
      <div className="w-full overflow-auto">
        <div className="min-w-[980px]">
          <div className="grid" style={{ gridTemplateColumns: `140px repeat(${DIAS.length}, 1fr)` }}>
            <div></div>
            {DIAS.map((d) => (
              <div key={d} className="p-3 text-center font-semibold bg-gray-50 border-b">
                {d}
              </div>
            ))}

            {TIME_LABELS.map((label, r) => (
              <React.Fragment key={`${label}-${r}`}>
                <div
                  className="px-2 py-1 text-xs text-gray-600 border-r flex items-start justify-end pr-3 bg-white"
                  style={{ height: SLOT_PX }}
                >
                  {label}
                </div>

                {DIAS.map((d) =>
                  r < SLOTS.length ? (
                    <DropCell key={`${d}|${r}`} id={`${d}|${r}`}>
                      {(() => {
                        const asgId = slotsMap[`${d}|${r}`];
                        if (!asgId) return null;
                        const a = assignments[asgId];
                        if (!a) return null;
                        if (a.startSlotIndex === r && a.dia === d) return <AssignmentCard a={a} />;
                        return null;
                      })()}
                    </DropCell>
                  ) : (
                    <div key={`${d}|end`} style={{ height: SLOT_PX }} className="border bg-gray-50" />
                  )
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>
    );
  }

  function onDragStart() {}
  async function onDragEnd(ev: any) {
    const { active, over } = ev;
    if (!over) return;
    const overId: string = over.id;
    if (!overId.includes("|")) return;

    const [diaStr, idxStr] = overId.split("|");
    const dia = DIAS.find((d) => d === (diaStr as Dia));
    const startIdx = Number(idxStr);
    if (!dia || Number.isNaN(startIdx)) return;

    if (active.id === "__new__") {
      await placeAssignment(dia, startIdx);
    } else {
      await moveAssignment(String(active.id), dia, startIdx);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Reserva de Laboratorio (UTEQ)</h1>
      <p className="text-sm text-gray-600">
        Lunes a Viernes · 07:30–17:30 · Bloques de 60 min · Guardado por semana (18 semanas)
      </p>

      {/* Pestañas de semanas */}
      <div className="flex flex-wrap items-center gap-2">
        {WEEKS.map((w) => (
          <button
            key={w}
            onClick={() => setCurrentWeek(w)}
            className={`px-3 py-1 rounded-full text-sm border ${
              w === currentWeek ? "bg-blue-600 text-white border-blue-600" : "bg-white hover:bg-gray-50"
            }`}
          >
            Semana {w}
          </button>
        ))}
        <span className="text-xs text-gray-500 ml-1">Los cambios se guardan al instante.</span>
      </div>

      {/* Indicaciones */}
      <div className="p-3 bg-blue-50 text-blue-900 text-sm rounded-lg border border-blue-200">
        <strong>Indicaciones:</strong> arrastra con <strong>click izquierdo</strong> para mover un bloque.
        Haz <strong>click derecho</strong> sobre un bloque para <strong>eliminarlo</strong>.
      </div>

      {/* Selector de asignatura (sin botón extra) */}
      <div className="flex flex-wrap items-center gap-3 p-4 rounded-2xl border bg-white shadow-sm">
        <CoursePicker value={selectedCourseId} setValue={setSelectedCourseId} />
        {busy && <span className="text-xs text-gray-500">Guardando…</span>}
      </div>

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} collisionDetection={closestCorners}>
        <div className="flex gap-4">
          <div className="flex-1">
            <Grid />
          </div>
          <div className="w-72">
            <div className="text-sm text-gray-600 mb-2">Bloque activo</div>
            <div className="min-h-[100px] p-2 rounded-xl border bg-white">
              <NewCardPreview />
            </div>
          </div>
        </div>
        <DragOverlay />
      </DndContext>
    </div>
  );
}
