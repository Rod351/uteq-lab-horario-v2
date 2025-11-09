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

/* ========= Firebase ========= */
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

/* ========= Horario ========= */
const LAB_ID = "lab-computo-uteq";
const WEEKS = Array.from({ length: 18 }, (_, i) => i + 1);

const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie"] as const;
type Dia = typeof DIAS[number];

const SLOT_MIN = 60;            // 60 min por bloque
const SLOT_PX  = 88;            // alto visual de cada fila/bloque (sube/baja si necesitas)
const HORA_INICIO = "07:30";
const HORA_FIN    = "17:30";

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
  const end   = hhmmToMinutes(HORA_FIN);
  const out: string[] = [];
  for (let t = start; t < end; t += SLOT_MIN) out.push(minutesToHHMM(t));
  return out; // ["07:30","08:30",...,"16:30"]
}
const SLOTS = buildSlots();
const TIME_LABELS = [...SLOTS, HORA_FIN];

/* ========= Datos / Tipos ========= */
type Assignment = {
  id: string;
  subject: string;
  sp: string;         // Semestre-Paralelo
  docente: string;
  dia: Dia;
  startSlotIndex: number;
  durationSlots: number; // siempre 1 (60 min)
  color?: string;
  uid: string;
  updatedAt?: any;
};
type ScheduleDoc = {
  slots?: Record<string, string>;
  assignments?: Record<string, Assignment>;
};
type CourseOption = {
  id: string; subject: string; sp: string; docente: string;
};

/* ========= Lista de cursos (recortada aquí, pega la tuya completa) ========= */
const COURSES: CourseOption[] = [
  { docente: "ARELLANO ORTIZ GABRIEL ALEJANDRO", subject: "CIENCIA DE LOS MATERIALES", sp: "4A", id: "CIENCIA DE LOS MATERIALES|4A|ARELLANO ORTIZ GABRIEL ALEJANDRO" },
  { docente: "ALMEIDA MURILLO WILMER FABRICIO", subject: "ÁLGEBRA LINEAL", sp: "1A", id: "ÁLGEBRA LINEAL|1A|ALMEIDA MURILLO WILMER FABRICIO" },
  // ⬆⬆⬆ Continúa con TODAS las filas que ya tenías (las que te pasé antes) ⬆⬆⬆
];

/* ========= UI helpers ========= */
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
      className={`relative border border-gray-200 hover:bg-gray-50 ${
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
}: {
  id: string;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id });
  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.85 : 1,
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

/* ========= App ========= */
export default function UTQScheduler() {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const [uid, setUid] = useState<string>("");
  const [busy, setBusy] = useState(false);

  /* Semana actual */
  const [currentWeek, setCurrentWeek] = useState<number>(1);
  const scheduleRef = useMemo(
    () => doc(db, "schedules", `${LAB_ID}-w${String(currentWeek).padStart(2, "0")}`),
    [currentWeek]
  );

  /* Estado remoto */
  const [schedule, setSchedule] = useState<ScheduleDoc>({
    assignments: {},
    slots: {},
  });
  const assignments = schedule.assignments || {};
  const slotsMap = schedule.slots || {};
  const slotKey = (dia: Dia, idx: number) => `${dia}|${idx}`;

  /* Selección de curso (para crear bloque nuevo) */
  const [selectedCourseId, setSelectedCourseId] = useState<string>("");

  /* Auth anónima */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) setUid(u.uid);
      else signInAnonymously(auth).catch(console.error);
    });
    return () => unsub();
  }, []);

  /* Suscripción Firestore */
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

  function getSelectedCourse(): CourseOption | null {
    if (!selectedCourseId) return null;
    return COURSES.find((c) => c.id === selectedCourseId) || null;
  }

  /* Crear (nuevo) */
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

        const dur = 1;
        if (startSlotIndex < 0 || startSlotIndex + dur > SLOTS.length) {
          throw new Error("Fuera de horario");
        }
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

        for (let i = 0; i < dur; i++) {
          slots[slotKey(dia, startSlotIndex + i)] = id;
        }
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

  /* Mover existente */
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

        for (let i = 0; i < current.durationSlots; i++) {
          const k = slotKey(current.dia, current.startSlotIndex + i);
          if (slots[k] === id) delete slots[k];
        }
        for (let i = 0; i < dur; i++) {
          slots[slotKey(dia, startSlotIndex + i)] = id;
        }

        asigs[id] = { ...current, dia, startSlotIndex, uid, updatedAt: serverTimestamp() };
        tx.set(scheduleRef, { slots, assignments: asigs }, { merge: true });
      });
    } catch (e: any) {
      alert(e.message || "No se pudo mover");
    } finally {
      setBusy(false);
    }
  }

  /* Eliminar (click derecho) */
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

  /* Tarjeta de una asignación (arrastrable y con click derecho) */
  function AssignmentCard({ a }: { a: Assignment }) {
    const height = SLOT_PX; // duración fija = 1 slot (60 min)
    const body = (
      <div
        className={`relative m-1 rounded-xl px-3 py-2 shadow-sm border ${a.color || "bg-blue-100 text-blue-800"}`}
        style={{ height }}
        onContextMenu={(e) => {
          e.preventDefault(); // evita menú del navegador
          deleteAssignment(a.id);
        }}
      >
        <div className="text-center leading-tight break-words">
          <div className="text-[12px] font-semibold">{a.subject}</div>
          <div className="text-[11px] opacity-80">{a.sp}</div>
          <div className="text-[11px] font-medium">{a.docente}</div>
        </div>
      </div>
    );
    return <DraggableCard id={a.id}>{body}</DraggableCard>;
  }

  /* Bloque nuevo (desde selector) */
  function NewCardPreview() {
    const course = getSelectedCourse();
    if (!course)
      return <div className="text-xs text-gray-400">Selecciona una asignatura para activar el bloque</div>;
    return (
      <DraggableCard id="__new__">
        <div
          className={`${colorForSubject(course.subject)} m-1 rounded-xl px-3 py-2 shadow-sm border`}
          style={{ height: SLOT_PX }}
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

  /* Grilla */
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

            {TIME_LABELS.map((hhmm, r) => (
              <React.Fragment key={`${hhmm}-${r}`}>
                <div
                  className="px-2 py-1 text-xs text-gray-600 border-r flex items-start justify-end pr-3 bg-white"
                  style={{ height: SLOT_PX }}
                >
                  {hhmm}
                </div>

                {DIAS.map((d) =>
                  r < SLOTS.length ? (
                    <DropCell key={`${d}|${r}`} id={`${d}|${r}`}>
                      {(() => {
                        const asgId = slotsMap[`${d}|${r}`];
                        if (!asgId) return null;
                        const a = assignments[asgId];
                        if (!a) return null;
                        if (a.startSlotIndex === r && a.dia === d) {
                          return <AssignmentCard a={a} />;
                        }
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

  /* DnD handlers */
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
      const id = String(active.id);
      await moveAssignment(id, dia, startIdx);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Reserva de Laboratorio (UTEQ)</h1>
      <p className="text-sm text-gray-600">
        Lunes a Viernes · 07:30–17:30 · Bloques de 60 min · Guardado por semana
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
        Haz <strong>click derecho</strong> sobre un bloque para <strong>eliminar</strong>.
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
