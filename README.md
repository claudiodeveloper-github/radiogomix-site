<p align="center">
  <img src="logo.jpg" alt="Rádio GoMix" width="200px" style="border-radius: 50%; box-shadow: 0 4px 8px rgba(0,0,0,0.2);" />
</p>

<h1 align="center">📻 Rádio GoMix</h1>

<p align="center">
  <img src="https://img.shields.io/badge/Java-21-red?style=for-the-badge&logo=openjdk&logoColor=white" alt="Java 21" />
  <img src="https://img.shields.io/badge/Spring%20Boot-3.2.5-brightgreen?style=for-the-badge&logo=springboot" alt="Spring Boot 3.2.5" />
  <img src="https://img.shields.io/badge/PostgreSQL-Supabase-blue?style=for-the-badge&logo=postgresql" alt="PostgreSQL Supabase" />
  <img src="https://img.shields.io/badge/PWA-Instal%C3%A1vel-orange?style=for-the-badge" alt="PWA Instalável" />
  <img src="https://img.shields.io/badge/Licen%C3%A7a-MIT-green?style=for-the-badge" alt="Licença MIT" />
</p>

<p align="center">
  Web Rádio Gospel 24h baseada na arquitetura e sincronização matemática <b>Faux-Live</b> · Solução de alta disponibilidade com custo zero de streaming.
</p>

<p align="center">
  👉 <b><a href="https://radiogomix.com.br">Ouvir Transmissão Ao Vivo</a></b>
</p>

---

## 🎯 O Problema de Engenharia Resolvido

Hospedar uma web rádio tradicional 24 horas ligada exige servidores de streaming dedicados (como Icecast ou Shoutcast) que cobram taxas mensais elevadas por largura de banda e conexões simultâneas de ouvintes. 

A **Rádio GoMix** elimina esse custo de infraestrutura utilizando o conceito de **Faux-Live** (Transmissão Simulada Direta):
Em vez de decodificar e transmitir um fluxo contínuo de áudio via servidor, o backend calcula milimetricamente com base no fuso horário qual hino e qual segundo exato da faixa deveria estar tocando agora. O frontend (cliente) consome esse ponteiro via JSON e ajusta o player HTML5 nativo para a posição correta, simulando uma rádio ao vivo com consumo de banda sob demanda.

---

## 🏗️ Arquitetura e Fluxo de Dados

A solução adota um modelo desacoplado (Decoupled Architecture), separando a casca visual estática do motor lógico do sistema.

+--------------------------------------------------------+
|                   CLIENTE (PWA)                        |
|             (https://radiogomix.com.br)                |
|                                                        |
|   - Polling nativo para sincronia temporal             |
|   - Service Worker (sw.js) otimizado para cache local  |
|   - MediaSession API para controles em Lock Screen     |
+---------------------------+----------------------------+
|
| HTTP GET /api/radio/no-ar (JSON)
v
+--------------------------------------------------------+
|            BACKEND ENGINE (Spring Boot)                |
|                                                        |
|   - RadioController: Endpoint público e Cross-Origin   |
|   - MidiaController: REST API para gestão e interrupção|
|   - AutomationService: Daemon agendado de segurança    |
|   - GradeService: Motor matemático de Timezone         |
+---------------------------+----------------------------+
|
| Spring Data JPA / HikariCP
v
+--------------------------------------------------------+
|              INFRAESTRUTURA DE NUVEM                   |
|                                                        |
|   - Supabase: PostgreSQL e Storage de arquivos .mp3    |
|   - GitHub Pages: Distribuição CDN global do Frontend  |
+--------------------------------------------------------+

---

## ⚙️ Inteligência do Core Backend

### 1. Sincronização Matemática Estável (`GradeService.java`)
Para evitar desvios temporais causados pela diferença de fusos entre servidores em nuvem e o dispositivo do cliente, o sistema centraliza o relógio oficial no fuso horário de Brasília (`America/Sao_Paulo`). O deslocamento do áudio é calculado em segundos e protegido contra estouros de buffer:




---

2. Automação da Timeline Infinita (AutomationService.java)
Um processo em background (@Scheduled) roda constantemente vigiando a tabela de programação. Se o robô detectar que a grade possui uma janela de segurança menor do que 24 horas à frente, ele reconstrói a escala automaticamente. A programação é gerada intercalando um catálogo de músicas, vinhetas, piadas e espaços publicitários, usando queries nativas randômicas do PostgreSQL:

@Scheduled(fixedDelay = 60000, initialDelay = 5000)
public void verificarEReabastecerGrade() {
    LocalDateTime agora = LocalDateTime.now();
    LocalDateTime janelaFim = agora.plusHours(24);

    if (gradeRepository.count() == 0 || !gradeRepository.existsSlotNaJanela(agora, janelaFim)) {
        gerarNovoBloco();
    }
}

3. Truncagem Cirúrgica para Intervenção Manual
Através do endpoint administrativo /api/admin/interrupcao, o sistema permite cortar a transmissão ao vivo instantaneamente para injetar uma mídia prioritária (como um boletim ou aviso urgente). O sistema encerra o slot atual no exato milissegundo da requisição e empilha a nova mídia sem quebrar a sequência lógica das faixas posteriores.

🎨 O Cliente (PWA)
O frontend foi desenvolvido de forma enxuta com JavaScript Vanilla, TailwindCSS e APIs nativas do navegador.

Service Worker (sw.js): Configurado estrategicamente para armazenar em cache as imagens e estruturas visuais (App Shell), aplicando bypass completo em arquivos .mp3 para evitar gargalo de memória.

MediaSession API: Permite o controle da rádio diretamente pela tela de bloqueio do celular ou centrais multimídia automotivas, exibindo metadados e capas dinâmicas enviadas pelo DTO do Spring Boot.

📦 Configuração e Execução do Projeto
Pré-requisitos
Java 21+

Maven 3+

Banco de Dados PostgreSQL (ou instância ativa no Supabase)

Variáveis de Ambiente Necessárias
O projeto adota boas práticas de segurança (12-Factor App) e não expõe credenciais de forma estática no código. Configure as variáveis no seu ambiente de execução:

export SUPABASE_PASSWORD="sua_senha_do_banco"
export PORT=8080

Compilação e Build
Para empacotar a aplicação Spring Boot gerando o arquivo executável pronto para produção (.jar), execute na raiz do diretório do backend:

mvn clean package -DskipTests

O arquivo gerado estará localizado em target/radiogomix-backend-0.0.1-SNAPSHOT.jar.

📄 Licença
Este projeto está sob a licença MIT. Veja o arquivo LICENSE para mais detalhes.

💡 Por que este README vai impressionar o Recrutador?
Foco em Engenharia: Ele não diz apenas "fiz uma rádio". Ele aborda o projeto como uma solução de Arquitetura de Software, explicando o problema, o custo resolvido e o padrão matemático adotado.

Uso de Termos Técnicos Certos: Termos como Decoupled Architecture, Polling nativo, 12-Factor App, Truncagem Cirúrgica e Bypass de Cache chamam muito a atenção de engenheiros de software seniores.

Organização: Mostra o fluxo visual em blocos e expõe os trechos mais complexos do código (GradeService e AutomationService), provando que você sabe estruturar regras de negócio robustas.

