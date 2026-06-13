# 📻 Rádio GoMix

![Java](https://img.shields.io/badge/Java-21-ED8B00?style=flat-square&logo=openjdk&logoColor=white)
![Spring Boot](https://img.shields.io/badge/Spring_Boot-3.2.5-6DB33F?style=flat-square&logo=springboot&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Supabase-3ECF8E?style=flat-square&logo=supabase&logoColor=white)
![PWA](https://img.shields.io/badge/PWA-Installable-5A0FC8?style=flat-square&logo=pwa&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)

> Uma estação de rádio 24/7 construída sobre uma arquitetura **Faux-Live** que elimina completamente os custos operacionais de streaming tradicional, mantendo a experiência de transmissão contínua para o ouvinte.

---

## O Problema de Engenharia Resolvido

Manter uma rádio online operando ininterruptamente exige, no modelo convencional, um servidor de streaming dedicado (Icecast, Shoutcast ou equivalente) com uma conexão de saída de alta largura de banda proporcional ao número simultâneo de ouvintes. O custo escala linearmente com a audiência: 100 ouvintes simultâneos consomem 100x mais banda que um único ouvinte.

O GoMix resolve isso eliminando o servidor de streaming da equação.

A premissa central é que uma transmissão de rádio é, em essência, um cronograma determinístico: sabe-se exatamente qual mídia deveria estar tocando em qualquer instante do tempo. Ao persistir esse cronograma no banco de dados e expô-lo via API, o backend consegue responder a qualquer cliente, a qualquer momento, com precisão de segundos: *"Você deveria estar no segundo `X` do arquivo `Y`"*.

O cliente então busca o arquivo de áudio diretamente do storage e faz o seek para a posição correta. O backend nunca carrega um único byte de áudio. A largura de banda do servidor é zero, independentemente de quantos ouvintes estiverem conectados.

---

## Arquitetura do Sistema

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENTE (PWA)                           │
│  ┌─────────────┐   ┌──────────────────┐   ┌─────────────────┐  │
│  │  index.html │   │    sw.js         │   │  MediaSession   │  │
│  │  (player    │   │  (Service Worker │   │  API            │  │
│  │   HTML5)    │   │   sem cache de   │   │  (Lock Screen / │  │
│  │             │   │   mídia pesada)  │   │   CarPlay)      │  │
│  └──────┬──────┘   └──────────────────┘   └─────────────────┘  │
│         │ 1. GET /api/grade/now                                  │
└─────────┼───────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    BACKEND (Spring Boot 3.2.5 / Java 21)        │
│                                                                 │
│  ┌──────────────────────────┐   ┌────────────────────────────┐  │
│  │      GradeService        │   │     AutomationService      │  │
│  │                          │   │                            │  │
│  │  Calcula o ponteiro      │   │  Daemon @Scheduled         │  │
│  │  exato em segundos da    │   │  (fixedDelay = 60s)        │  │
│  │  mídia atual usando      │   │                            │  │
│  │  ZonedDateTime (BRT)     │   │  Preenche lacunas de 24h   │  │
│  │  → Epoch Milliseconds    │   │  com blocos: 3♪ 1V 1J 1P   │  │
│  └──────────┬───────────────┘   └────────────────────────────┘  │
│             │ 2. Retorna {url, seekTo}                           │
│             │                                                    │
│  ┌──────────┴───────────────┐                                   │
│  │    Spring Data JPA       │                                   │
│  │    (PostgreSQL queries)  │                                   │
│  └──────────┬───────────────┘                                   │
└─────────────┼───────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         SUPABASE                                │
│                                                                 │
│   ┌─────────────────────┐      ┌──────────────────────────┐    │
│   │  PostgreSQL          │      │  Storage (Bucket)        │    │
│   │  (grade / schedule)  │      │  Arquivos .mp3 públicos  │    │
│   └─────────────────────┘      └──────────────────────────┘    │
│                                          ▲                      │
└──────────────────────────────────────────┼──────────────────────┘
                                           │ 3. Fetch do .mp3 + seek
                                           │    (direto pelo cliente)
                                    ┌──────┴──────┐
                                    │   CLIENTE   │
                                    │  (HTML5     │
                                    │   Audio)    │
                                    └─────────────┘
```

O cliente faz exatamente **duas** operações de rede: uma chamada leve à API para obter os metadados do slot atual, e um fetch direto ao storage para o arquivo de áudio. O backend nunca participa do transporte de mídia.

---

## Core Backend: Inteligência e Resiliência

### 1. Sincronização de Timezone — `GradeService.java`

O ponto mais sensível de todo o sistema é o cálculo do ponteiro de tempo. Um desvio de timezone entre o servidor e o cliente produziria um seek incorreto, quebrando a ilusão de transmissão ao vivo.

A solução centraliza toda a lógica temporal no fuso horário de Brasília (`America/Sao_Paulo`) e converte para Epoch Milliseconds antes de qualquer aritmética. Epoch é um valor absoluto, sem ambiguidade de timezone, o que torna a comparação com o relógio do cliente segura mesmo que ele esteja em outro fuso.

```java
ZoneId ZONE_BRT = ZoneId.of("America/Sao_Paulo");

public NowPlayingDTO getNowPlaying() {
    long nowEpoch = ZonedDateTime.now(ZONE_BRT).toInstant().toEpochMilli();

    GradeSlot slot = repository.findActiveSlot(nowEpoch)
        .orElseThrow(() -> new NoActiveSlotException("Grade sem cobertura para o instante atual."));

    long elapsedMs  = nowEpoch - slot.getStartEpoch();
    long seekSeconds = elapsedMs / 1000;

    return new NowPlayingDTO(slot.getMediaUrl(), seekSeconds, slot.getTitle());
}
```

O cliente recebe `seekSeconds` e aplica `audioElement.currentTime = seekSeconds`, posicionando o player exatamente onde a transmissão estaria.

---

### 2. Automação Contínua da Grade — `AutomationService.java`

A grade precisa existir antes que o cliente a consulte. Um daemon agendado avalia continuamente uma janela de 24 horas à frente e, ao detectar qualquer lacuna temporal, reconstrói os blocos faltantes.

```java
@Scheduled(fixedDelay = 60_000)
public void fillScheduleGaps() {
    long nowEpoch    = ZonedDateTime.now(ZONE_BRT).toInstant().toEpochMilli();
    long horizonEpoch = nowEpoch + Duration.ofHours(24).toMillis();

    List<TimeGap> gaps = gradeRepository.findGapsInRange(nowEpoch, horizonEpoch);

    for (TimeGap gap : gaps) {
        long cursor = gap.getStart();
        while (cursor < gap.getEnd()) {
            cursor += insertBlock(cursor); // 3 Músicas → 1 Vinheta → 1 Piada → 1 Propaganda
        }
    }
}

private long insertBlock(long startEpoch) {
    long blockDuration = 0;
    blockDuration += insertRandom(TipoMidia.MUSICA,     3, startEpoch + blockDuration);
    blockDuration += insertRandom(TipoMidia.VINHETA,    1, startEpoch + blockDuration);
    blockDuration += insertRandom(TipoMidia.PIADA,      1, startEpoch + blockDuration);
    blockDuration += insertRandom(TipoMidia.PROPAGANDA, 1, startEpoch + blockDuration);
    return blockDuration;
}
```

A randomização usa queries com `ORDER BY RANDOM()` no PostgreSQL, garantindo variedade sem lógica de playlist no código da aplicação.

---

### 3. Intervenção Manual — Endpoint de Truncagem

Para inserção imediata de mídias prioritárias (boletins, mensagens urgentes), existe um endpoint administrativo que encerra cirurgicamente o slot em execução e recalcula todos os slots subsequentes para manter a grade consistente.

```java
@PostMapping("/admin/grade/truncate-and-insert")
public ResponseEntity<Void> truncateAndInsert(@RequestBody PriorityMediaDTO dto) {
    long nowEpoch = ZonedDateTime.now(ZONE_BRT).toInstant().toEpochMilli();
    gradeService.truncateCurrentSlotAt(nowEpoch);
    gradeService.insertPriorityMedia(dto, nowEpoch);
    return ResponseEntity.noContent().build();
}
```

---

## Cliente PWA: Diferenciais Técnicos

### Tolerância a Desvios de Latência

A latência de rede entre a requisição à API e a execução do seek introduz um atraso real. Para absorvê-lo sem produzir um salto perceptível no áudio, o frontend aplica um seek apenas quando o desvio ultrapassa um limiar configurado:

```javascript
const SEEK_TOLERANCE_S = 5;

function syncPlayback(seekTo) {
    const drift = Math.abs(audio.currentTime - seekTo);
    if (drift > SEEK_TOLERANCE_S) {
        audio.currentTime = seekTo;
    }
}
```

Desvios dentro da janela de 5 segundos são absorvidos naturalmente, preservando a continuidade do áudio.

### Service Worker com Bypass de Mídia Pesada

O `sw.js` implementa uma estratégia de cache seletiva: assets estáticos da PWA (HTML, CSS, JS, ícones) são cacheados normalmente para funcionamento offline, mas requisições para arquivos `.mp3` são sempre roteadas direto para a rede, sem passar pelo cache.

Cachear áudio no Service Worker consumiria a cota de armazenamento do navegador rapidamente e produziria erros silenciosos em dispositivos com pouca memória. O bypass garante que o storage do dispositivo nunca seja sobrecarregado pelo conteúdo de mídia.

### MediaSession API — Integração com Lock Screen e Sistemas Automotivos

Os metadados do slot atual (título, artista, capa) são publicados na `MediaSession API` do navegador, permitindo que o sistema operacional exiba as informações corretamente na tela de bloqueio do Android e iOS, nos controles de mídia do macOS e no painel de entretenimento de veículos com suporte a Android Auto e Apple CarPlay.

```javascript
navigator.mediaSession.metadata = new MediaMetadata({
    title:  slot.title,
    artist: slot.artist,
    album:  'Rádio GoMix',
    artwork: [{ src: slot.coverUrl, sizes: '512x512', type: 'image/png' }]
});
```

---

## Configuração e Implantação

O projeto segue os princípios do **Twelve-Factor App**: toda configuração sensível é injetada via variáveis de ambiente, sem nenhum segredo em código-fonte ou arquivos versionados.

### Variáveis de Ambiente Requeridas

| Variável              | Descrição                                                               |
|-----------------------|-------------------------------------------------------------------------|
| `SUPABASE_PASSWORD`   | Senha do usuário PostgreSQL do projeto Supabase                         |
| `PORT`                | Porta HTTP em que o servidor será exposto (padrão: `8080`)              |

Configure o datasource no `application.properties` (ou via variáveis do ambiente de deploy):

```properties
spring.datasource.url=jdbc:postgresql://db.<project-ref>.supabase.co:5432/postgres
spring.datasource.username=postgres
spring.datasource.password=${SUPABASE_PASSWORD}
server.port=${PORT:8080}
```

### Build

```bash
mvn clean package -DskipTests
java -jar target/gomix-*.jar
```

O frontend (PWA estático) é hospedado independentemente no **GitHub Pages** com domínio próprio, desacoplado do ciclo de deploy do backend.

---

## Licença

Distribuído sob a licença [MIT](LICENSE).

---

## Autor

Desenvolvido por **Cláudio G. S. Castro** — engenheiro que acredita que a melhor solução de infraestrutura é frequentemente aquela que torna um servidor inteiro desnecessário.
