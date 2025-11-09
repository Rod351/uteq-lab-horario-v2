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

/** ============================================================
 *  CONFIG
 *  ============================================================ */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyC4Q_qgs-bXtWHhSyQRAS3CJr1NxkY04m0",
  authDomain: "uteq-lab-horarios.firebaseapp.com",
  projectId: "uteq-lab-horarios",
  storageBucket: "uteq-lab-horarios.firebasestorage.app",
  messagingSenderId: "248562477461",
  appId: "1:248562477461:web:96c0ec509da12cc8f8ae9c",
};

const LAB_ID = "lab-computo-uteq";
const WEEKS = Array.from({ length: 18 }, (_, i) => i + 1);

/** ============================================================
 *  HORARIO (L–V, 07:30–17:30, bloques fijos de 60 min)
 *  ============================================================ */
const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie"] as const;
const SLOT_MIN = 60;
const HORA_INICIO = "07:30";
const HORA_FIN = "17:30";

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
  const start = hhmmToMinutes(HORA_INICIO);
  const end = hhmmToMinutes(HORA_FIN);
  const out: string[] = [];
  for (let t = start; t < end; t += SLOT_MIN) out.push(minutesToHHMM(t));
  return out;
}
const SLOTS = buildSlots();

/** ============================================================
 *  TIPOS
 *  ============================================================ */
type Dia = typeof DIAS[number];

type Assignment = {
  id: string;
  subject: string;  // asignatura
  sp: string;       // semestre-paralelo
  docente: string;  // docente
  dia: Dia;
  startSlotIndex: number;    // índice en SLOTS
  durationSlots: number;     // siempre 1 (60 min)
  color?: string;
  uid: string;
  updatedAt?: any;
};

type ScheduleDoc = {
  slots?: Record<string, string>;        // key = `${dia}|${slotIndex}`, value = assignmentId
  assignments?: Record<string, Assignment>;
};

type CourseOption = {
  id: string;
  subject: string;
  sp: string;        // "8A", "1B", etc.
  docente: string;
};

/** ============================================================
 *  LISTADO: cada fila de tu tabla es una opción única
 *  (id = subject|sp|docente para que no haya ambigüedad)
 *  ============================================================ */
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

  { docente: "CULCAY VELIZ MARIASOL BELEN", subject: "CONTABILIDAD  DE COSTOS", sp: "4A", id: "CONTABILIDAD  DE COSTOS|4A|CULCAY VELIZ MARIASOL BELEN" },
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

/** ============================================================
 *  FIREBASE INIT
 *  ============================================================ */
const app = initializeApp(FIREBASE_CONFIG);
const db = getFirestore(app);
const auth = getAuth(app);

/** ============================================================
 *  UI helpers
 *  ============================================================ */
function DropCell({ id, children }: { id: string; children?: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`relative h-14 border border-gray-200 hover:bg-gray-50 ${
        isOver ? "ring-2 ring-blue-400" : ""
      }`}
    >
      {children}
    </div>
  );
}

function DraggableCard({
  id,
  children,
  disabled,
}: {
  id: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id, disabled });
  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.8 : 1,
    zIndex: isDragging ? 50 : 1,
  } as React.CSSProperties;
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className="cursor-grab active:cursor-grabbing"
    >
      {children}
    </div>
  );
}

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

/** ============================================================
 *  SELECTOR de cursos: una opción por fila (muestra asignatura · sp · docente)
 *  ============================================================ */
function CoursePicker({
  value,             // id de CourseOption
  setValue,
}: {
  value: string;
  setValue: (v: string) => void;
}) {
  const options = useMemo(() => COURSES, []);
  return (
    <div className="flex items-center gap-2">
      <select
        className="border rounded-lg px-3 py-2 text-sm w-[520px]"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      >
        <option value="">— Selecciona —</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.subject} · {o.sp} · {o.docente}
          </option>
        ))}
      </select>
    </div>
  );
}

/** ============================================================
 *  APP
 *  ============================================================ */
export default function UTQScheduler() {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const [uid, setUid] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const [currentWeek, setCurrentWeek] = useState<number>(1);
  const scheduleRef = useMemo(
    () => doc(db, "schedules", `${LAB_ID}-w${String(currentWeek).padStart(2, "0")}`),
    [currentWeek]
  );

  const [schedule, setSchedule] = useState<ScheduleDoc>({
    assignments: {},
    slots: {},
  });

  // selección del picker
  const [selectedCourseId, setSelectedCourseId] = useState<string>("");

  // estado mover
  const [movingId, setMovingId] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) setUid(u.uid);
      else signInAnonymously(auth).catch(console.error);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(scheduleRef, (snap) => {
      const data = (snap.data() as ScheduleDoc) || { assignments: {}, slots: {} };
      setSchedule({
        assignments: data.assignments || {},
        slots: data.slots || {},
      });
    });
    return () => unsub();
  }, [scheduleRef]);

  const assignments = schedule.assignments || {};
  const slotsMap = schedule.slots || {};
  const slotKey = (dia: Dia, idx: number) => `${dia}|${idx}`;

  function getSelectedCourse(): CourseOption | null {
    if (!selectedCourseId) return null;
    return COURSES.find((c) => c.id === selectedCourseId) || null;
    }

  /** Crear una asignación (siempre 60 min = 1 slot) */
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

        const durationSlots = 1; // 60 min
        if (startSlotIndex < 0 || startSlotIndex + durationSlots > SLOTS.length) {
          throw new Error("Fuera de horario");
        }
        for (let i = 0; i < durationSlots; i++) {
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
          durationSlots,
          color: colorForSubject(course.subject),
          uid,
          updatedAt: serverTimestamp(),
        };

        for (let i = 0; i < durationSlots; i++) {
          slots[slotKey(dia, startSlotIndex + i)] = id;
        }
        asigs[id] = asg;

        tx.set(
          scheduleRef,
          { slots, assignments: asigs },
          { merge: true }
        );
      });
      setSelectedCourseId("");
    } catch (e: any) {
      alert(e.message || "No se pudo asignar");
    } finally {
      setBusy(false);
    }
  }

  /** Mover una asignación existente */
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

        const dur = 1;
        if (startSlotIndex < 0 || startSlotIndex + dur > SLOTS.length) {
          throw new Error("Fuera de horario");
        }
        for (let i = 0; i < dur; i++) {
          const k = slotKey(dia, startSlotIndex + i);
          const occ = slots[k];
          if (occ && occ !== id) throw new Error("Choque con otra asignatura");
        }

        // libera anteriores
        const prev = current;
        for (let i = 0; i < prev.durationSlots; i++) {
          const k = slotKey(prev.dia, prev.startSlotIndex + i);
          if (slots[k] === id) delete slots[k];
        }
        // ocupa nuevos
        for (let i = 0; i < dur; i++) {
          slots[slotKey(dia, startSlotIndex + i)] = id;
        }

        asigs[id] = {
          ...current,
          dia,
          startSlotIndex,
          durationSlots: 1,
          uid,
          updatedAt: serverTimestamp(),
        };

        tx.set(scheduleRef, { slots, assignments: asigs }, { merge: true });
      });
    } catch (e: any) {
      alert(e.message || "No se pudo mover");
    } finally {
      setBusy(false);
      setMovingId(null);
    }
  }

  /** Eliminar */
  async function deleteAssignment(id: string) {
    if (!confirm("¿Eliminar esta asignación del horario?")) return;
    setBusy(true);
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(scheduleRef);
        const data = (snap.data() as ScheduleDoc) || { slots: {}, assignments: {} };
        const slots = { ...(data.slots || {}) } as Record<string, string>;
        const asigs = { ...(data.assignments || {}) } as Record<string, Assignment>;
        const current = asigs[id];
        if (!current) return;

        for (let i = 0; i < current.durationSlots; i++) {
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

  /** ========== RENDER ========== */
  function Grid() {
    return (
      <div className="w-full overflow-auto">
        <div className="min-w-[980px]">
          <div
            className="grid"
            style={{ gridTemplateColumns: `140px repeat(${DIAS.length}, 1fr)` }}
          >
            <div></div>
            {DIAS.map((d) => (
              <div key={d} className="p-3 text-center font-semibold bg-gray-50 border-b">
                {d}
              </div>
            ))}

            {SLOTS.map((hhmm, r) => (
              <React.Fragment key={hhmm}>
                <div className="h-14 px-2 py-1 text-xs text-gray-600 border-r flex items-start justify-end pr-3 bg-white">
                  {hhmm}
                </div>
                {DIAS.map((d) => {
                  const k = slotKey(d, r);
                  const asgId = slotsMap[k];

                  return (
                    <DropCell key={k} id={k}>
                      {asgId &&
                        (() => {
                          const a = assignments[asgId];
                          if (!a) return null;
                          if (a.startSlotIndex === r && a.dia === d) {
                            return (
                              <AssignmentCard
                                a={a}
                                isMoving={movingId === a.id}
                                onAskMove={() => setMovingId(a.id)}
                                onDelete={() => deleteAssignment(a.id)}
                              />
                            );
                          }
                          return null;
                        })()}
                    </DropCell>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>
    );
  }

  function AssignmentCard({
    a,
    onAskMove,
    onDelete,
    isMoving,
  }: {
    a: Assignment;
    onAskMove: () => void;
    onDelete: () => void;
    isMoving: boolean;
  }) {
    const height = 56; // 1 hora
    const body = (
      <div
        className={`relative m-1 rounded-xl px-3 py-2 shadow-sm border ${a.color || "bg-blue-100 text-blue-800"}`}
        style={{ height }}
      >
        <div className="text-center">
          <div className="text-[12px] font-semibold leading-tight">{a.subject}</div>
          <div className="text-[11px] opacity-80 leading-tight">{a.sp}</div>
          <div className="text-[11px] font-medium leading-tight">{a.docente}</div>
        </div>

        <div className="absolute left-2 bottom-1 text-[10px] opacity-70">
          {SLOTS[a.startSlotIndex]} · 60 min
        </div>

        {!isMoving && (
          <div className="absolute right-1 top-1 flex gap-1">
            <button
              className="text-[10px] px-2 py-1 bg-white/80 hover:bg-white rounded border"
              onClick={onAskMove}
            >
              Mover
            </button>
            <button
              className="text-[10px] px-2 py-1 bg-white/80 hover:bg-white rounded border"
              onClick={onDelete}
            >
              Eliminar
            </button>
          </div>
        )}

        {isMoving && (
          <div className="absolute right-1 top-1">
            <span className="text-[10px] bg-yellow-100 border rounded px-2 py-1">
              Arrastra para reubicar…
            </span>
          </div>
        )}
      </div>
    );

    // Solo se puede arrastrar cuando está en modo “Mover”
    return (
      <DraggableCard id={isMoving ? a.id : `${a.id}-locked`} disabled={!isMoving}>
        {body}
      </DraggableCard>
    );
  }

  function NewCardPreview() {
    const course = getSelectedCourse();
    if (!course) return (
      <div className="text-xs text-gray-400">Selecciona una asignatura para activar el bloque</div>
    );

    return (
      <DraggableCard id="__new__">
        <div
          className={`${colorForSubject(course.subject)} m-1 rounded-xl px-3 py-2 shadow-sm border`}
          style={{ height: 56 }}
        >
          <div className="text-center">
            <div className="text-[12px] font-semibold leading-tight">{course.subject}</div>
            <div className="text-[11px] opacity-80 leading-tight">{course.sp}</div>
            <div className="text-[11px] font-medium leading-tight">{course.docente}</div>
          </div>
          <div className="absolute left-2 bottom-1 text-[10px] opacity-70">60 min · Arrastra a la grilla</div>
        </div>
      </DraggableCard>
    );
  }

  function onDragStart(ev: any) {}
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
      const id = String(active.id);
      if (movingId && id === movingId) {
        await moveAssignment(id, dia, startIdx);
      }
    }
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Reserva de Laboratorio (UTEQ) — Demo</h1>
      <p className="text-sm text-gray-600">
        Multiusuario en tiempo real con Firebase. Lunes a Viernes, 07:30–17:30 (bloques de 60 min).
        Elige una opción del listado, activa el bloque y arrástralo a la grilla.
      </p>

      {/* Pestañas 1..18 semanas */}
      <div className="flex flex-wrap items-center gap-2">
        {WEEKS.map((w) => (
          <button
            key={w}
            onClick={() => setCurrentWeek(w)}
            className={`px-3 py-1 rounded-full text-sm border ${
              w === currentWeek
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white hover:bg-gray-50"
            }`}
          >
            Semana {w}
          </button>
        ))}
        <span className="text-xs text-gray-500 ml-1">Se guarda automáticamente por semana.</span>
      </div>

      {/* Panel superior */}
      <div className="flex flex-wrap items-center gap-3 p-4 rounded-2xl border bg-white shadow-sm">
        <CoursePicker value={selectedCourseId} setValue={setSelectedCourseId} />
        <button
          className={`px-4 py-2 rounded-xl text-sm font-semibold text-white ${
            selectedCourseId ? "bg-blue-600 hover:bg-blue-700" : "bg-gray-400 cursor-not-allowed"
          }`}
          disabled={!selectedCourseId}
        >
          Activar bloque movible
        </button>
        {busy && <span className="text-xs text-gray-500">Guardando…</span>}
      </div>

      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        collisionDetection={closestCorners}
      >
        <div className="flex gap-4">
          <div className="flex-1">
            <Grid />
          </div>
          <div className="w-72">
            <div className="text-sm text-gray-600 mb-2">Bloque activo</div>
            <div className="min-h-[100px] p-2 rounded-xl border bg-white relative">
              <NewCardPreview />
            </div>
          </div>
        </div>
        <DragOverlay />
      </DndContext>
    </div>
  );
}
