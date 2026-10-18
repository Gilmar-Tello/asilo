// Lectura y validación de importes y fechas que llegan de los formularios (Finanzas y demás módulos nuevos).
// El servidor SIEMPRE valida: el navegador se puede saltar.

const MAX_IMPORTE = 999999.99;   // cabe en DECIMAL(10,2) con margen

// Importe en quetzales: "25", "25.5" o "25,50". Devuelve el número, o null si no es válido.
// Con 'permitirCero' en false, el 0 tampoco vale (un pago o una donación de Q0 no tiene sentido).
function leerImporte(valor, permitirCero = false) {
  const limpio = String(valor === undefined || valor === null ? '' : valor).trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(limpio)) return null;

  const numero = Number(limpio);
  if (numero > MAX_IMPORTE) return null;
  if (!permitirCero && numero <= 0) return null;
  return numero;
}

// Redondea a centavos (evita 0.30000000000000004)
function centavos(numero) {
  return Math.round(Number(numero) * 100) / 100;
}

// Fecha como 'AAAA-MM-DD' (hora local del servidor)
function aTexto(fecha) {
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
}

function hoy() {
  return aTexto(new Date());
}

// Fecha 'AAAA-MM-DD' que exista de verdad (rechaza 31 de febrero). Devuelve el texto o null.
function leerFecha(valor) {
  const t = String(valor || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const [a, m, d] = t.split('-').map(Number);
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d ? t : null;
}

// Mes 'AAAA-MM' (como lo manda <input type="month">). Devuelve 'AAAA-MM-01' o null.
function leerMes(valor) {
  const t = String(valor || '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(t)) return null;
  return `${t}-01`;
}

// Primer y último día del mes actual (rango por defecto de los listados)
function mesActual() {
  const f = new Date();
  const desde = new Date(f.getFullYear(), f.getMonth(), 1);
  const hasta = new Date(f.getFullYear(), f.getMonth() + 1, 0);
  return { desde: aTexto(desde), hasta: aTexto(hasta), mes: aTexto(desde).slice(0, 7) };
}

module.exports = { leerImporte, centavos, hoy, leerFecha, leerMes, mesActual, MAX_IMPORTE };
