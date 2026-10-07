const express = require('express');
//creacion apliacion/servidor
const app = express();
//leera los datos en formato json
app.use(express.json());

// Un importe valido es un numero finito, no negativo
const esImporte = (valor) => typeof valor === 'number' && Number.isFinite(valor) && valor >= 0;

// Redondea a 2 decimales (evita resultados como 0.30000000000000004)
const redondear = (valor) => Math.round(valor * 100) / 100;

//microservicio: calcular costo
app.post('/calcular-costo', (req, res) => {
    //recibe los costos
    const { consulta, examenes, medicamentos } = req.body || {};

    // Si llega texto o un numero negativo se rechaza: "5" + 3 daria "53" en JavaScript
    if (![consulta, examenes, medicamentos].every(esImporte)) {
        return res.status(400).json({ mensaje: 'consulta, examenes y medicamentos deben ser numeros mayores o iguales a 0' });
    }

    //suma todo
    const subtotal = redondear(consulta + examenes + medicamentos);

    //descuento ficticio de la fundacion 20%
    const descuento = redondear(subtotal * 0.20);
    const total = redondear(subtotal - descuento);

    //resultado
    res.json({
        subtotal: subtotal,
        descuento: descuento,
        total: total
    });
});

//abre el microservicio en el puerto 3000
app.listen(3000, () => {
    console.log('Microservicio de calcular costo corre en http://localhost:3000');
});
