import { db } from './firebase-config.js';
import { collection, onSnapshot, query, where, orderBy, updateDoc, doc, addDoc, deleteDoc, getDocs, setDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ==========================================
// 1. GERENCIAR FILA (COM FILTRO DE DATA E CONTADOR)
// ==========================================
const adminFilaList = document.getElementById('adminFilaList');
const dataFilaAdmin = document.getElementById('dataFilaAdmin');
const contadorConcluidosDia = document.getElementById('contadorConcluidosDia');

let escutaFilaAtual = null;

// Retorna a data atual no formato YYYY-MM-DD respeitando o fuso horário local
function obterDataHojeLocal() {
    const agora = new Date();
    const ano = agora.getFullYear();
    const mes = String(agora.getMonth() + 1).padStart(2, '0');
    const dia = String(agora.getDate()).padStart(2, '0');
    return `${ano}-${mes}-${dia}`;
}

// Função global de notificação
function mostrarNotificacao(mensagem, tipo = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${tipo}`;
    toast.innerHTML = `
        <span>${mensagem}</span>
        <button onclick="this.parentElement.remove()">&times;</button>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        if (toast.parentElement) toast.remove();
    }, 4000);
}

function carregarFilaAdmin(dataSelecionada) {
    if (escutaFilaAtual) {
        escutaFilaAtual();
    }

    const filaRef = collection(db, "fila");
    const q = query(filaRef, where("data", "==", dataSelecionada), orderBy("timestamp", "asc"));

    escutaFilaAtual = onSnapshot(q, (snapshot) => {
        if (!adminFilaList) return;
        adminFilaList.innerHTML = '';

        let totalConcluidosNoDia = 0;
        let ativosNaFila = 0;

        snapshot.forEach((documento) => {
            const cliente = documento.data();
            const id = documento.id;

            // Conta quantos clientes foram concluídos nesta data
            if (cliente.status === 'concluido') {
                totalConcluidosNoDia++;
            }

            if (cliente.status === 'aguardando' || cliente.status === 'cortando') {
                ativosNaFila++;
                const totalCliente = cliente.servicos.reduce((acc, serv) => acc + serv.valor, 0);
                const servicosNomes = cliente.servicos.map(s => s.nome).join(', ');
                const isCortando = cliente.status === 'cortando';

                const numeroLimpo = cliente.whatsapp ? cliente.whatsapp.replace(/\D/g, '') : '';

                const btnWhatsapp = cliente.whatsapp ?
                    `<a href="https://wa.me/55${numeroLimpo}" target="_blank" style="display: block; text-align: center; background: linear-gradient(135deg, #25D366, #128C7E); color: white; padding: 12px; border-radius: 8px; font-weight: bold; text-decoration: none; margin-bottom: 10px; box-shadow: 0 4px 15px rgba(37, 211, 102, 0.3); transition: all 0.3s ease;">
                        💬 Chamar no WhatsApp
                    </a>` : '';

                adminFilaList.innerHTML += `
                    <div class="cliente-card ${isCortando ? 'destaque' : ''}">
                        <h3>${cliente.nome}</h3>
                        <p style="margin: 5px 0; color: #a0a0a0;">📱 ${cliente.whatsapp || 'Não informado'}</p>
                        <p>Serviços: ${servicosNomes} (R$ ${totalCliente.toFixed(2)})</p>
                        <p>Status: <strong>${cliente.status.toUpperCase()}</strong></p>
                        
                        <div class="acoes" style="margin-top: 15px;">
                            ${btnWhatsapp}
                            <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                                ${!isCortando ? `<button onclick="alterarStatus('${id}', 'cortando')" style="flex: 1; background-color: #d4af37; color: black;">✂️ Iniciar</button>` : ''}
                                <button onclick="alterarStatus('${id}', 'concluido')" class="btn-success" style="flex: 1;">✅ Concluir</button>
                                <button onclick="alterarStatus('${id}', 'ausente')" class="btn-danger" style="flex: 1;">❌ Ausente</button>
                            </div>
                        </div>
                    </div>
                `;
            }
        });

        // Atualiza o contador de clientes concluídos em tempo real
        if (contadorConcluidosDia) {
            contadorConcluidosDia.innerText = totalConcluidosNoDia;
        }

        if (ativosNaFila === 0) {
            const partes = dataSelecionada.split('-');
            const dataFormatada = partes.length === 3 ? `${partes[2]}/${partes[1]}/${partes[0]}` : dataSelecionada;
            adminFilaList.innerHTML = `<p style="color: #a0a0a0;">Nenhum cliente na fila (Aguardando ou Cortando) para o dia ${dataFormatada}.</p>`;
        }
    });
}

if (dataFilaAdmin) {
    dataFilaAdmin.addEventListener('change', (e) => {
        carregarFilaAdmin(e.target.value);
    });
}

// Função global para atualizar o status e contabilizar concluídos no Firestore
window.alterarStatus = async function (id, novoStatus) {
    const clienteRef = doc(db, "fila", id);
    try {
        await updateDoc(clienteRef, {
            status: novoStatus
        });

        if (novoStatus === 'concluido') {
            mostrarNotificacao("Atendimento concluído e contabilizado!", "success");
        } else if (novoStatus === 'cortando') {
            mostrarNotificacao("Atendimento iniciado!", "info");
        } else if (novoStatus === 'ausente') {
            mostrarNotificacao("Cliente marcado como ausente.", "error");
        }
    } catch (error) {
        console.error("Erro ao atualizar status:", error);
        mostrarNotificacao("Erro ao atualizar status do cliente.", "error");
    }
}

// ==========================================
// 2. FINANCEIRO E CONTADOR DE ATENDIMENTOS
// ==========================================
let clientesConcluidosGlobais = [];

function processarFinanceiro() {
    const filtroMesVal = document.getElementById('filtroMes').value;
    const filtroSemanaVal = document.getElementById('filtroSemana').value;

    const dataRefSemana = filtroSemanaVal ? new Date(filtroSemanaVal + "T12:00:00") : new Date();

    const inicioSemana = new Date(dataRefSemana);
    inicioSemana.setDate(dataRefSemana.getDate() - dataRefSemana.getDay());
    const fimSemana = new Date(inicioSemana);
    fimSemana.setDate(inicioSemana.getDate() + 6);

    const formatoData = (data) => `${data.getDate().toString().padStart(2, '0')}/${(data.getMonth() + 1).toString().padStart(2, '0')}/${data.getFullYear()}`;
    const nomeDaSemana = `${formatoData(inicioSemana)} a ${formatoData(fimSemana)}`;

    let mesFiltrado, anoFiltradoParaMes;
    if (filtroMesVal) {
        const partesMes = filtroMesVal.split('-');
        anoFiltradoParaMes = parseInt(partesMes[0]);
        mesFiltrado = parseInt(partesMes[1]) - 1;
    } else {
        const dataAtualMes = new Date();
        anoFiltradoParaMes = dataAtualMes.getFullYear();
        mesFiltrado = dataAtualMes.getMonth();
    }

    const anoAtual = new Date().getFullYear();

    let totalAnual = 0;
    let totalMensal = 0;
    let totalSemanal = 0;
    let qtdAtendidosMes = 0;

    clientesConcluidosGlobais.forEach(cliente => {
        const dataAtendimento = new Date(cliente.data + "T12:00:00");
        const valorCorte = cliente.servicos.reduce((acc, serv) => acc + serv.valor, 0);

        if (dataAtendimento.getFullYear() === anoAtual) {
            totalAnual += valorCorte;
        }

        if (dataAtendimento.getFullYear() === anoFiltradoParaMes && dataAtendimento.getMonth() === mesFiltrado) {
            totalMensal += valorCorte;
            qtdAtendidosMes++;
        }

        if (dataAtendimento >= inicioSemana && dataAtendimento <= fimSemana) {
            totalSemanal += valorCorte;
        }
    });

    document.getElementById('balancoSemanal').innerHTML = `R$ ${totalSemanal.toFixed(2)} <br><small style="font-size:12px; color:#ccc;">${nomeDaSemana}</small>`;
    document.getElementById('balancoMensal').innerText = `R$ ${totalMensal.toFixed(2)}`;
    document.getElementById('balancoAnual').innerText = `R$ ${totalAnual.toFixed(2)}`;

    if (document.getElementById('contadorConcluidosMes')) {
        document.getElementById('contadorConcluidosMes').innerText = qtdAtendidosMes;
    }
    if (document.getElementById('contadorConcluidosGeral')) {
        document.getElementById('contadorConcluidosGeral').innerText = clientesConcluidosGlobais.length;
    }
}

function calcularBalançoFinanceiro() {
    const filaRef = collection(db, "fila");
    const q = query(filaRef, where("status", "==", "concluido"));

    onSnapshot(q, (snapshot) => {
        clientesConcluidosGlobais = [];
        snapshot.forEach((doc) => clientesConcluidosGlobais.push(doc.data()));

        processarFinanceiro();
    });
}

if (document.getElementById('filtroMes')) {
    document.getElementById('filtroMes').addEventListener('change', processarFinanceiro);
}
if (document.getElementById('filtroSemana')) {
    document.getElementById('filtroSemana').addEventListener('change', processarFinanceiro);
}

// ==========================================
// 3. SERVIÇOS E VALORES
// ==========================================
const formServico = document.getElementById('formServico');
const listaServicosAdmin = document.getElementById('listaServicosAdmin');

function carregarServicosAdmin() {
    const servicosRef = collection(db, "servicos");

    onSnapshot(servicosRef, (snapshot) => {
        if (listaServicosAdmin) listaServicosAdmin.innerHTML = '';

        snapshot.forEach((documento) => {
            const servico = documento.data();
            const id = documento.id;

            if (listaServicosAdmin) {
                listaServicosAdmin.innerHTML += `
                    <li style="display: flex; justify-content: space-between; align-items: center; padding: 10px; background: #2a2d34; margin-bottom: 8px; border-radius: 4px;">
                        <span><strong>${servico.nome}</strong> - R$ ${servico.valor.toFixed(2)}</span>
                        <button onclick="deletarServico('${id}')" class="btn-danger" style="padding: 6px 12px;">Excluir</button>
                    </li>
                `;
            }
        });
    });
}

if (formServico) {
    formServico.addEventListener('submit', async (e) => {
        e.preventDefault();
        const nome = document.getElementById('nomeServico').value;
        const valor = parseFloat(document.getElementById('valorServico').value);

        try {
            await addDoc(collection(db, "servicos"), { nome: nome, valor: valor });
            mostrarNotificacao("Serviço cadastrado com sucesso!", "success");
            formServico.reset();
        } catch (error) {
            console.error("Erro ao cadastrar serviço:", error);
        }
    });
}

window.deletarServico = async function (id) {
    if (confirm("Tem certeza que deseja excluir este serviço?")) {
        await deleteDoc(doc(db, "servicos", id));
    }
}

// ==========================================
// 4. GERENCIAR DATAS (BLOQUEIO E DESBLOQUEIO)
// ==========================================
const listaDatasAdmin = document.getElementById('listaDatasAdmin');

function carregarDatasBloqueadas() {
    const datasRef = collection(db, "datas_indisponiveis");

    onSnapshot(datasRef, (snapshot) => {
        if (listaDatasAdmin) listaDatasAdmin.innerHTML = '';

        snapshot.forEach((documento) => {
            const dataDoc = documento.data();
            const id = documento.id;

            const partes = dataDoc.data.split('-');
            const dataFormatada = partes.length === 3 ? `${partes[2]}/${partes[1]}/${partes[0]}` : dataDoc.data;

            if (listaDatasAdmin) {
                listaDatasAdmin.innerHTML += `
                    <li style="display: flex; justify-content: space-between; align-items: center; padding: 10px; background: #2a2d34; margin-bottom: 8px; border-radius: 4px; border-left: 4px solid #dc3545;">
                        <span>🔒 <strong>${dataFormatada}</strong> está bloqueada</span>
                        <button onclick="desbloquearData('${id}')" class="btn-success" style="padding: 6px 12px; border: none; border-radius: 4px; cursor: pointer;">✅ Desbloquear</button>
                    </li>
                `;
            }
        });

        if (snapshot.empty && listaDatasAdmin) {
            listaDatasAdmin.innerHTML = '<p style="color: #a0a0a0;">Nenhuma data bloqueada no momento. A agenda está livre.</p>';
        }
    });
}

window.bloquearData = async function () {
    const dataInput = document.getElementById('dataBloqueio').value;
    if (!dataInput) return mostrarNotificacao("Selecione uma data para bloquear.", "info");

    try {
        const datasRef = collection(db, "datas_indisponiveis");
        const q = query(datasRef, where("data", "==", dataInput));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
            return mostrarNotificacao("Esta data já está bloqueada!", "error");
        }

        await addDoc(datasRef, { data: dataInput });
        mostrarNotificacao("Data bloqueada com sucesso!", "success");
        document.getElementById('dataBloqueio').value = '';

    } catch (error) {
        console.error("Erro ao bloquear:", error);
    }
}

window.desbloquearData = async function (id) {
    if (confirm("Tem certeza que deseja desbloquear esta data? Os clientes poderão voltar a se cadastrar nela.")) {
        try {
            await deleteDoc(doc(db, "datas_indisponiveis", id));
        } catch (error) {
            console.error("Erro ao desbloquear data:", error);
        }
    }
}

// ==========================================
// 5. HISTÓRICO DE CLIENTES
// ==========================================
const listaHistoricoAdmin = document.getElementById('listaHistoricoAdmin');

function carregarHistoricoAdmin() {
    const filaRef = collection(db, "fila");
    const q = query(filaRef, orderBy("timestamp", "desc"));

    onSnapshot(q, (snapshot) => {
        if (listaHistoricoAdmin) listaHistoricoAdmin.innerHTML = '';

        snapshot.forEach((documento) => {
            const cliente = documento.data();

            if (cliente.timestamp) {
                const totalCliente = cliente.servicos.reduce((acc, serv) => acc + serv.valor, 0);
                const servicosNomes = cliente.servicos.map(s => s.nome).join(', ');

                const partes = cliente.data.split('-');
                const dataFormatada = partes.length === 3 ? `${partes[2]}/${partes[1]}/${partes[0]}` : cliente.data;

                let statusHtml = '';
                if (cliente.status === 'concluido') {
                    statusHtml = '<span style="color: #28a745; font-weight: bold;">✅ Concluído</span>';
                } else if (cliente.status === 'ausente') {
                    statusHtml = '<span style="color: #dc3545; font-weight: bold;">❌ Ausente</span>';
                } else if (cliente.status === 'cortando') {
                    statusHtml = '<span style="color: var(--gold); font-weight: bold;">✂️ Cortando</span>';
                } else {
                    statusHtml = '<span style="color: #a0a0a0; font-weight: bold;">⏳ Aguardando</span>';
                }

                if (listaHistoricoAdmin) {
                    listaHistoricoAdmin.innerHTML += `
                        <li style="display: flex; flex-direction: column; padding: 15px; background: #2a2d34; margin-bottom: 10px; border-radius: 4px; border-left: 4px solid var(--gold);">
                            <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                                <strong style="font-size: 1.1rem;">${cliente.nome}</strong>
                                <span>🗓️ ${dataFormatada}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; font-size: 0.9rem; color: #ccc;">
                                <span>Serviços: ${servicosNomes} <strong style="color:white;">(R$ ${totalCliente.toFixed(2)})</strong></span>
                                ${statusHtml}
                            </div>
                        </li>
                    `;
                }
            }
        });

        if (snapshot.empty && listaHistoricoAdmin) {
            listaHistoricoAdmin.innerHTML = '<p style="color: #a0a0a0;">Nenhum histórico encontrado no sistema.</p>';
        }
    });
}

// ==========================================
// 6. CONFIGURAÇÃO DE HORÁRIOS DE ATENDIMENTO
// ==========================================
const docHorarioRef = doc(db, "configuracoes", "horario_atendimento");

onSnapshot(docHorarioRef, (docSnap) => {
    if (docSnap.exists()) {
        const data = docSnap.data();
        const check24h = document.getElementById('check24h');
        const inputAbertura = document.getElementById('horaAbertura');
        const inputFechamento = document.getElementById('horaFechamento');

        if (check24h && inputAbertura && inputFechamento) {
            check24h.checked = data.is24h || false;
            inputAbertura.value = data.abertura || '';
            inputFechamento.value = data.fechamento || '';

            inputAbertura.disabled = data.is24h;
            inputFechamento.disabled = data.is24h;
        }
    }
});

const check24hElement = document.getElementById('check24h');
if (check24hElement) {
    check24hElement.addEventListener('change', (e) => {
        document.getElementById('horaAbertura').disabled = e.target.checked;
        document.getElementById('horaFechamento').disabled = e.target.checked;
    });
}

window.salvarHorarios = async function () {
    const is24h = document.getElementById('check24h').checked;
    const abertura = document.getElementById('horaAbertura').value;
    const fechamento = document.getElementById('horaFechamento').value;

    if (!is24h && (!abertura || !fechamento)) {
        mostrarNotificacao("Preencha abertura e fechamento, ou marque 24h.", "error");
        return;
    }

    try {
        await setDoc(docHorarioRef, {
            is24h: is24h,
            abertura: abertura,
            fechamento: fechamento
        });

        mostrarNotificacao("Horários atualizados com sucesso!", "success");
    } catch (error) {
        console.error("Erro ao salvar horário:", error);
    }
};

// ==========================================
// INICIALIZAÇÃO DO SISTEMA
// ==========================================
const dataHoje = obterDataHojeLocal();
if (document.getElementById('dataFilaAdmin')) document.getElementById('dataFilaAdmin').value = dataHoje;
carregarFilaAdmin(dataHoje);

const dataMesAtual = dataHoje.substring(0, 7);
if (document.getElementById('filtroMes')) document.getElementById('filtroMes').value = dataMesAtual;
if (document.getElementById('filtroSemana')) document.getElementById('filtroSemana').value = dataHoje;

calcularBalançoFinanceiro();
carregarServicosAdmin();
carregarDatasBloqueadas();
carregarHistoricoAdmin();