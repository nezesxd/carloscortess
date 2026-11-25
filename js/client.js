import { db } from './firebase-config.js';
import { collection, addDoc, onSnapshot, query, where, orderBy, serverTimestamp, getDocs, doc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const form = document.getElementById('filaForm');
const listaServicosDiv = document.getElementById('listaServicos');
const filaAtualUl = document.getElementById('filaAtual');

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

// 1. Carregar os Serviços Disponíveis do Banco
async function carregarServicos() {
    const servicosRef = collection(db, "servicos");
    const snapshot = await getDocs(servicosRef);

    listaServicosDiv.innerHTML = '';

    snapshot.forEach((doc) => {
        const servico = doc.data();
        listaServicosDiv.innerHTML += `
            <label>
                <input type="checkbox" name="servico" value="${servico.nome}" data-valor="${servico.valor}">
                ${servico.nome} - R$ ${servico.valor.toFixed(2)}
            </label><br>
        `;
    });
}

// 2. Ouvir a Fila de Hoje em Tempo Real
function escutarFilaHoje() {
    const hoje = obterDataHojeLocal();
    const filaRef = collection(db, "fila");
    const q = query(filaRef, where("data", "==", hoje), orderBy("timestamp", "asc"));

    onSnapshot(q, (snapshot) => {
        filaAtualUl.innerHTML = '';
        let posicao = 1;

        snapshot.forEach((doc) => {
            const cliente = doc.data();
            // Mostra apenas quem está aguardando ou cortando
            if (cliente.status === 'aguardando' || cliente.status === 'cortando') {
                const statusBadge = cliente.status === 'cortando' ? '✂️ Cortando agora' : '⏳ Aguardando';

                filaAtualUl.innerHTML += `
                    <li>
                        <strong>${posicao}º - ${cliente.nome}</strong> 
                        <span class="status">${statusBadge}</span>
                    </li>
                `;
                posicao++;
            }
        });

        if (posicao === 1) {
            filaAtualUl.innerHTML = '<li>Nenhum cliente na fila no momento. Seja o primeiro!</li>';
        }
    });
}

// ==========================================
// MOSTRAR HORÁRIO DE ATENDIMENTO
// ==========================================
const docHorarioRef = doc(db, "configuracoes", "horario_atendimento");
const horarioTexto = document.getElementById('horarioFuncionamento');

let configuracaoHorario = { is24h: true, abertura: '00:00', fechamento: '23:59' };

onSnapshot(docHorarioRef, (docSnap) => {
    if (docSnap.exists()) {
        configuracaoHorario = docSnap.data();

        if (configuracaoHorario.is24h) {
            horarioTexto.innerHTML = "🕒 <strong>Atendimento 24 Horas</strong>";
        } else {
            horarioTexto.innerHTML = `🕒 Lista aberta das <strong>${configuracaoHorario.abertura} às ${configuracaoHorario.fechamento}</strong>`;
        }
    } else {
        horarioTexto.innerHTML = "🕒 Horários ainda não definidos pelo barbeiro.";
    }
});

// 3. Cadastrar Cliente na Fila de Hoje
form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // 0. VERIFICAÇÃO DO HORÁRIO DE FUNCIONAMENTO
    if (!configuracaoHorario.is24h && configuracaoHorario.abertura && configuracaoHorario.fechamento) {
        const agora = new Date();
        const tempoAtualEmMinutos = (agora.getHours() * 60) + agora.getMinutes();

        const [aberturaHora, aberturaMin] = configuracaoHorario.abertura.split(':').map(Number);
        const tempoAbertura = (aberturaHora * 60) + aberturaMin;

        const [fechamentoHora, fechamentoMin] = configuracaoHorario.fechamento.split(':').map(Number);
        const tempoFechamento = (fechamentoHora * 60) + fechamentoMin;

        let estaAberto = false;

        if (tempoFechamento >= tempoAbertura) {
            estaAberto = tempoAtualEmMinutos >= tempoAbertura && tempoAtualEmMinutos <= tempoFechamento;
        } else {
            estaAberto = tempoAtualEmMinutos >= tempoAbertura || tempoAtualEmMinutos <= tempoFechamento;
        }

        if (!estaAberto) {
            mostrarNotificacao(`Estamos fechados! O horário de atendimento é das ${configuracaoHorario.abertura} às ${configuracaoHorario.fechamento}.`, "error");
            return;
        }
    }

    const hoje = obterDataHojeLocal();

    // VERIFICAÇÃO SE O DIA DE HOJE ESTÁ BLOQUEADO NO PAINEL ADMIN
    const datasRef = collection(db, "datas_indisponiveis");
    const bloqueioQuery = query(datasRef, where("data", "==", hoje));
    const datasSnap = await getDocs(bloqueioQuery);

    if (!datasSnap.empty) {
        mostrarNotificacao("A lista de atendimento foi encerrada para hoje.", "error");
        return;
    }

    const nome = document.getElementById('nomeCliente').value.trim();
    const whatsapp = document.getElementById('whatsappCliente').value.trim();

    const servicosSelecionados = Array.from(document.querySelectorAll('input[name="servico"]:checked')).map(cb => ({
        nome: cb.value,
        valor: parseFloat(cb.dataset.valor)
    }));

    if (servicosSelecionados.length === 0) {
        mostrarNotificacao("Por favor, selecione pelo menos um serviço.", "info");
        return;
    }

    try {
        await addDoc(collection(db, "fila"), {
            nome: nome,
            whatsapp: whatsapp,
            data: hoje,
            servicos: servicosSelecionados,
            status: "aguardando",
            timestamp: serverTimestamp()
        });

        mostrarNotificacao("Você entrou na fila com sucesso!", "success");
        form.reset();

    } catch (error) {
        console.error("Erro ao entrar na fila: ", error);
        mostrarNotificacao("Erro ao processar. Tente novamente.", "error");
    }
});

// Inicialização
carregarServicos();
escutarFilaHoje();

// ==========================================
// TELA DE BEM-VINDO (SPLASH SCREEN)
// ==========================================
window.addEventListener('load', () => {
    const splashScreen = document.getElementById('splash-screen');

    if (splashScreen) {
        setTimeout(() => {
            splashScreen.style.opacity = '0';
            splashScreen.style.visibility = 'hidden';

            setTimeout(() => {
                splashScreen.remove();
            }, 600);
        }, 2000);
    }
});

// ==========================================
// MÁSCARA AUTOMÁTICA DO WHATSAPP
// ==========================================
const inputWhatsapp = document.getElementById('whatsappCliente');
if (inputWhatsapp) {
    inputWhatsapp.addEventListener('input', function (e) {
        let valor = e.target.value.replace(/\D/g, '');
        let formatado = valor;

        if (valor.length > 2) {
            formatado = `(${valor.substring(0, 2)}) ${valor.substring(2)}`;
        }
        if (valor.length > 7) {
            formatado = `(${valor.substring(0, 2)}) ${valor.substring(2, 7)}-${valor.substring(7, 11)}`;
        }

        e.target.value = formatado;
    });
}