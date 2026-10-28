# MangaReader — primeira etapa offline

Aplicativo pessoal exclusivamente Android. Expo SDK 58, React Native 0.88, React 19.3, TypeScript estrito, Expo Router, SQLite e arquivos privados. Sem backend. A etapa inicial do catálogo MangaDex está disponível, com busca e metadados de capítulos.

## Executar no Windows

1. Instale Node compatível com SDK 58 (este projeto foi preparado com Node 24.21.0 / npm 11.19.0).
2. Instale Android Studio pelo site oficial. No SDK Manager instale as plataformas/Build Tools exigidas pelo Expo SDK 58 e Android SDK Platform-Tools. Use o JDK incluído no Android Studio.
3. Ajuste as variáveis na sessão PowerShell (ajuste os caminhos se sua instalação diferir):

```powershell
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\emulator;$env:Path"
java -version
adb version
```

4. Celular físico: habilite opções de desenvolvedor e depuração USB, conecte por USB e aceite a chave RSA no celular. `adb devices` deve mostrar `device`, sem `unauthorized`. Para emulador, crie e inicie um dispositivo no Device Manager do Android Studio.
5. Na pasta do projeto:

```powershell
npm ci
npm run android
```

Esse comando compila e instala um **development build**, e inicia o Metro. Nas próximas sessões: `npm start` e abra o development build instalado. Se o celular não alcançar o Metro por Wi-Fi:

```powershell
adb reverse tcp:8081 tcp:8081
npm start -- --localhost
```

Para validar offline sem Metro, gere e instale a versão com JavaScript embutido:

```powershell
npx expo run:android --variant release
```

O projeto não oferece comandos ou dependências de web/iOS. O Expo Go não é o caminho documentado de execução.

## Teste com CBZ sintético

```powershell
npm run fixture
adb push fixtures/teste.cbz /sdcard/Download/teste.cbz
```

Abra “Importar CBZ”, selecione o arquivo em Downloads. As páginas são `1.png`, `2.png`, `10.png`: devem aparecer nessa ordem (uma, duas e três faixas claras). Próxima página: toque na metade esquerda, deslize para a direita ou use “← Próxima”. Página anterior: metade direita, deslize para a esquerda ou “Anterior →”. O modo vertical mostra as páginas em uma faixa contínua. Role para cima/baixo sem trocar de imagem pelos botões; o contador e o progresso acompanham a primeira página com presença significativa na tela. Os botões continuam disponíveis para saltar entre páginas.

Verifique no Android:

- importar, cancelar seletor e tentar arquivo inválido;
- abrir biblioteca, capa e contagem de páginas;
- avançar, voltar, chegar aos extremos, alternar modo;
- fechar e reabrir: página e modo devem persistir;
- ativar modo avião no build release e repetir leitura;
- remover com confirmação e conferir desaparecimento;
- repetir com CBZ próprio grande e observar memória e fluidez.

## Implementação e limites

- `app/`: biblioteca, leitor e provider SQLite.
- `src/services/zip.ts`: parser ZIP de acesso aleatório, independente do dispositivo e testável.
- `src/services/library.ts`: seletor, cópia privada, importação, extração sob demanda e remoção.
- `src/storage/database.ts`: esquema SQLite versionado com transação.
- `tests/`: ordem numérica, extração stored/deflate, CRC, caminhos perigosos, ZIP inválido e formatos rejeitados.

O leitor ZIP usa `File.open()`/`FileHandle` do Expo para buscar trechos no disco; `fflate` usa Uint8Array em JavaScript puro e somente o inflador síncrono, sem Node, workers ou APIs de navegador. Não usa `unzipSync` no volume. Na importação, valida uma página por vez e conserva somente a capa. Na leitura página a página, extrai a página solicitada e conserva um cache de vizinhas. Na leitura vertical, uma FlatList virtualizada monta apenas uma janela próxima da tela; a extração é sequencial, com cache separado por sessão e arquivos retidos enquanto as células estiverem montadas. `expo-image` recebe URI local com `contentFit="contain"` e sem cache de memória no leitor. A compatibilidade final e o consumo de memória ainda exigem teste no Android/Hermes.

Limites deliberados: CBZ até 2 GiB; diretório central até 8 MiB; até 10 mil entradas e 5 mil imagens; cada página comprimida/descomprimida até 24 MiB; total declarado até 4 GiB; taxa de compressão até 300. ZIP64, multivolume, links simbólicos, criptografia e métodos além de stored/deflate são rejeitados. Caminhos absolutos, barras invertidas, segmentos `..`/`.` e controles são rejeitados; nenhum nome do ZIP vira caminho de saída. São aceitos JPG/JPEG, PNG e WebP, com assinatura e CRC verificados. A decodificação real é feita por expo-image; uma assinatura válida não garante imagem decodificável. Imagens de dimensões enormes ainda podem pressionar a memória nativa: teste com seus arquivos antes de considerar o leitor validado.

Uma página é descomprimida em RAM (até 24 MiB, além dos buffers); nunca o volume inteiro. Essa operação é síncrona e pode causar pausas em aparelhos lentos. O UUID é estável após a importação; importar novamente cria outro item. Não há deduplicação. Interrupção abrupta durante importação pode deixar diretório privado órfão; recuperação automática fica pendente. Remoção apaga primeiro os metadados, depois arquivos: falha de disco pode exigir limpeza futura.

## Verificações

```powershell
npm run typecheck
npm test
npx expo install --check
npx expo export --platform android
```

Não há configuração de lint nesta entrega. Build e testes físicos dependem do SDK/JDK/dispositivo. Consulte o relato da entrega para os resultados efetivamente executados.

Referências: [SDK 58](https://expo.dev/changelog/sdk-58), [Expo FileSystem](https://docs.expo.dev/versions/latest/sdk/filesystem/), [fflate](https://github.com/101arrowz/fflate).

## Resultado da validação nesta entrega

- `npm run typecheck`: passou.
- `npm test`: 3 grupos passaram, incluindo extração stored/deflate, ordem numérica, CRC, rejeição de caminhos suspeitos, truncamento, ZIP64, criptografia e assinatura inválida.
- `npm run fixture`: gerou `fixtures/teste.cbz`.
- `EXPO_OFFLINE=1 npx expo install --check`: dependências alinhadas à tabela local do SDK; a consulta online não estava disponível no sandbox.
- `EXPO_OFFLINE=1 npx expo export --platform android`: passou, gerando bundle Hermes Android (1.218 módulos). Isso não equivale a compilar/instalar um APK.
- `npm audit`: 8 avisos (5 baixos e 3 altos) na árvore Expo, originados em `deepmerge` e `zod`. A correção automática sugeria downgrade incompatível do Expo para SDK 51 e não foi aplicada.
- O Router trouxe `react-dom` transitivamente. O override para 19.3.0 alinha esse peer à versão de React do template oficial; isso não adiciona uma versão web ao produto.
- Build nativo, dispositivo/emulador, gestos, persistência entre reinícios, leitura em modo avião e perfil de memória: **pendentes de validação Android**. Java, ADB e Android SDK não foram encontrados no ambiente inspecionado.

### Importação no Expo Go

O seletor entrega a URI original autorizada (`copyToCacheDirectory: false`) e o serviço aguarda a cópia diretamente para o armazenamento privado. Isso evita depender de uma cópia temporária do DocumentPicker potencialmente fora da pasta do projeto no Expo Go. O arquivo original nunca é removido pela importação. Testes com fronteiras nativas simuladas verificam a ordem da cópia, a propagação de erro e a preservação da origem; a permissão real ainda deve ser confirmada no celular.

Para abrir pelo Expo Go compatível com SDK 58: `npx expo start --go --clear`.

### Arquivos maiores para testes manuais

- `fixtures/teste-100-paginas.cbz`: 100 PNGs sintéticos de 800 × 1200, numerados de 001 a 100; aproximadamente 35 MiB. As entradas físicas estão invertidas e os nomes não têm zeros à esquerda, para exercitar a ordenação numérica.
- `fixtures/invalido-sem-imagens.zip`: ZIP válido contendo apenas texto; deve ser rejeitado pela extensão.
- `fixtures/invalido-sem-imagens.cbz`: o mesmo ZIP com extensão CBZ; deve ser rejeitado por não conter imagens.

Recriar e validar todos esses arquivos: `node --experimental-strip-types scripts/create-large-fixtures.ts`. O script confere contagem, ordem, assinatura e CRC de cada página, além da rejeição do arquivo sem imagens. Transfira os arquivos para Downloads no celular e importe pelo aplicativo.


### Leitura vertical contínua

Ative “Modo: página a página” para alternar para “Modo: vertical contínuo”. Na primeira abertura vertical de cada item, o app percorre as páginas sequencialmente para obter dimensões dos cabeçalhos PNG/JPEG/WebP, sem decodificar pixels nem conservar o capítulo inteiro em RAM. O resultado é salvo em `sizes.json`; isso também funciona para livros importados anteriormente, sem reimportação. Essa preparação pode demorar em volumes grandes e para ao sair do leitor.

As alturas proporcionais permitem posicionar a lista diretamente na página salva. O progresso persiste por número da página, não pela posição exata em pixels dentro de uma imagem longa. Ao alternar o modo, o leitor mantém a página atual. A lista usa janela de cinco telas, lotes de duas células e imagens locais sem cache de memória do expo-image. A extração continua síncrona por página; fluidez e memória precisam ser verificadas em aparelho real.

Teste no celular com `npx expo start --go`:

1. Abra o CBZ de 100 páginas e alterne para o modo vertical.
2. Role por várias imagens sem tocar em Próxima; confira ordem e contador.
3. Volte rolando para páginas anteriores e experimente os dois botões.
4. Feche o app e reabra: deve restaurar o modo vertical no início da página salva.
5. Alterne para página a página e confira se permanece na mesma página.
6. Teste também um CBZ com alturas diferentes ou imagens longas, e gire o celular.

Validação desta mudança: TypeScript e 10 testes passaram (incluindo dimensões de imagens, cálculo de posições e retenção/liberação do cache). Os testes do cache simulam a fronteira nativa; a interação por rolagem e o consumo real de memória dependem de validação no Android.

## Gerar APK independente com EAS Build

O perfil `preview` em `eas.json` produz um APK Android de distribuição interna, com JavaScript embutido e `developmentClient: false`. Ele funciona sem Expo Go, sem Metro e sem o computador. A compilação é feita nos servidores Expo e exige conta Expo autenticada e conexão à internet durante o build. Não publica o app na Play Store. Referência: https://docs.expo.dev/build-reference/apk/

O projeto fixa o EAS CLI 26.0.0 no comando abaixo. No PowerShell, dentro da pasta do projeto:

```powershell
npx eas-cli@26.0.0 login
npm run build:apk
```

Na primeira execução:

1. Se solicitado, aceite criar/vincular o projeto `manga-reader` à sua conta Expo. A associação pode adicionar `extra.eas.projectId` ao `app.json`.
2. Para a primeira chave Android, aceite gerar um novo Android Keystore. O EAS gerenciará a assinatura; reutilize a mesma chave nas próximas versões para atualizar o app instalado.
3. Aguarde o build terminar. O terminal mostrará o endereço do build no painel Expo.
4. Abra o link no celular, baixe e instale o APK. Se o Android solicitar, autorize a instalação para o navegador utilizado.

Não inclua chaves/senhas em arquivos versionados. `.easignore` exclui cache npm, bundles locais e CBZs de teste do envio ao EAS, além das credenciais locais.

### Validar o APK offline

O APK tem armazenamento separado do Expo Go: os mangás importados no Expo Go não aparecem automaticamente nele. Os CBZs originais em Downloads continuam disponíveis para importar.

1. Abra o MangaReader instalado pelo APK e importe o CBZ de teste de Downloads.
2. Feche o app, encerre o Metro no computador e ative modo avião no celular.
3. Abra novamente pelo ícone MangaReader. Confira biblioteca, leitura nos dois modos e restauração de progresso.
4. Ainda sem internet, importe outro CBZ que já esteja em Downloads e confirme a remoção de um item.

Estado desta etapa: perfil e comandos preparados. A geração efetiva do APK e a instalação precisam ser confirmadas após autenticação e conclusão do build EAS. Os testes bem-sucedidos informados pelo usuário até aqui foram feitos no Expo Go.

### Primeiro APK concluído

Build EAS concluído com status FINISHED na conta pessoal `andremoreirap`, perfil `preview`, versão 0.1.0 (1), pacote `com.andre.mangareader`.

- Painel: https://expo.dev/accounts/andremoreirap/projects/manga-reader/builds/8b04e35b-7cb8-4f9e-a9ac-332ed4c4e531
- APK: https://expo.dev/artifacts/eas/Yv0YKA-CEUIK23mrL64_z9G9UIhY0CBC8Tp13T2P-lY.apk

O projeto local foi vinculado por `extra.eas.projectId` no app.json. A assinatura Android foi gerada e é gerenciada pelo EAS. A compilação foi confirmada; a instalação e a validação offline deste APK no celular continuam pendentes. Para outra compilação, execute `npm run build:apk` com a mesma conta e chave.


## MVP 2 — catálogo MangaDex (primeira etapa)

O APK 0.1.0 testado pelo usuário confirmou a instalação e leitura offline, incluindo o modo vertical. A etapa atual adiciona consulta online ao catálogo; o leitor e a biblioteca de CBZs continuam locais.

### Testar no Android

```powershell
npm ci
npx expo start --go
```

1. Na biblioteca, toque em **Explorar MangaDex**.
2. Digite pelo menos dois caracteres e toque em **Buscar**. A pesquisa não dispara a cada tecla.
3. Abra um título e confira capa, sinopse e capítulos. Há preferência automática por PT-BR quando esse idioma consta dos metadados; caso contrário, inglês ou todos os idiomas. Os filtros permitem trocar manualmente.
4. Use **Carregar mais** nos resultados e capítulos para verificar a paginação.
5. Tente consultar outro título sem conexão e confira a mensagem de erro e o botão de tentar novamente.
6. Volte à biblioteca e confira a leitura dos CBZs importados. Nenhum login MangaDex é necessário para estes endpoints públicos.

O APK gerado anteriormente não incorpora alterações locais automaticamente. Após validar esta etapa no Expo Go, uma nova compilação com `npm run build:apk` incluirá o catálogo no aplicativo independente.

### Arquivos e decisões

- `src/types/manga-source.ts`: contrato `MangaSource` e modelos independentes da API.
- `src/services/mangadex/source.ts`: cliente oficial HTTP, mapeamento e validação de respostas, paginação e controle de requisições.
- `src/providers/remote.ts`: fonte e cache do TanStack Query, compatível com React 19; nenhuma nova dependência nativa.
- `app/catalog/`: busca, detalhes e capítulos; estilos e capa em `src/features/catalog/`.
- `tests/mangadex.test.ts`: respostas, idioma, paginação, cancelamento, HTTP 403/429 e falhas de rede.
- `scripts/check-mangadex.ts`: verificação opcional de metadados na API real, executada com `npx tsx scripts/check-mangadex.ts`.

As requisições são serializadas com intervalo mínimo de um segundo, User-Agent descritivo e timeout de 20 segundos. HTTP 429 ativa a pausa informada nos cabeçalhos, sem repetição automática. HTTP 403 é apresentado como recusa de acesso; não há scraping, proxy ou contorno de bloqueios. A consulta de capítulos omite links externos e capítulos futuros. Busca usa as classificações safe e suggestive. A UI credita MangaDex e exibe grupos de tradução quando informados; capas indisponíveis recebem placeholder.

O TanStack Query conserva resultados em memória por até 30 minutos de inatividade, com validade de cinco minutos e repetição automática desabilitada. Esse cache não persiste ao fechar o app nem torna o catálogo disponível offline. Segredos e credenciais não são necessários nesta etapa.

Referência consultada: [OpenAPI oficial MangaDex 5.13.1](https://api.mangadex.org/docs/api.yaml). A política exige créditos à fonte e aos grupos quando houver leitura, e proíbe anúncios/serviços pagos. Neste incremento, há somente consulta de títulos e metadados; leitura remota, download e armazenamento de capítulos serão a próxima etapa.

Verificação real executada: busca de `Yotsuba&!`, detalhes de `Yotsuba to!` e primeira página de capítulos PT-BR (50 resultados, total 170 no momento da consulta). Não foram baixadas páginas de capítulos. TypeScript e os 16 testes passaram. A integração de rede no celular ainda precisa de validação pelo usuário.

O bundle Hermes Android desta etapa também foi gerado com sucesso (`npx expo export --platform android`, 1.271 módulos). Isso valida o empacotamento JavaScript; o APK anterior continua sendo a versão offline sem o novo catálogo.

## Tela inicial — biblioteca para celular

A biblioteca usa lista vertical de cards, com capa, título, quantidade de páginas, posição atual e barra de progresso. O item em andamento acessado mais recentemente recebe o destaque “Continuar leitura”. A posição corresponde à página salva, não a uma confirmação de que todas as páginas anteriores foram lidas. O filtro “Em leitura” usa páginas intermediárias: primeira e última páginas não recebem esse estado, já que o esquema atual não registra início/finalização explícitos.

Recursos da tela:

- Busca local por título, ignorando acentos e diferenças de maiúsculas/minúsculas.
- Filtros Todos e Em leitura, com contagem.
- Ordenação por último acesso ou título A–Z, pelo ícone ao lado dos filtros.
- Botão Importar no topo; após importar, a busca/filtro são limpos para mostrar o novo item.
- Toque no card para abrir o leitor. Menu de três pontos para abrir ou remover, com confirmação e preservação do CBZ original.
- Navegação inferior Biblioteca/Explorar (MangaDex). Não há abas de downloads ou histórico sem implementação.
- Estado vazio com orientação de importação, busca sem resultados, erro, carregamento e fallback de capa.
- Área segura do Android respeitada no topo e rodapé; lista permanece vertical também em telas maiores.

Arquivos: `app/index.tsx`, componentes e seletores em `src/features/library/`, testes em `tests/library-selectors.test.ts`. Nenhuma dependência, migração de banco ou comportamento do leitor foi adicionado nesta mudança. O fluxo de download por capítulo está descrito na seção seguinte.

Validação executada: TypeScript, 20 testes e bundle Hermes Android passaram. Não há lint configurado no projeto. A aparência e a interação final precisam ser conferidas no celular:

```powershell
npx expo start --go
```

Confira biblioteca vazia, cards com títulos longos, busca por acentos, filtro Em leitura, ordenação, importação, menu de remoção e navegação para o catálogo. O APK já instalado não recebe essa alteração automaticamente; uma nova compilação será necessária para incorporar o layout fora do Expo Go.

### Menus da biblioteca

Menu do item, ordenação e confirmação de remoção usam o componente `src/features/library/LibraryActionSheet.tsx`, com painel inferior escuro, ações de remoção em vermelho e indicação da ordenação selecionada. Toque fora, botão Fechar/Cancelar ou Voltar do Android fecham o painel. O fluxo de confirmação permanece obrigatório antes de apagar um item. Não há novas dependências.


## MVP 2 — download por capítulo

Na tela de detalhes, cada capítulo disponível tem **Baixar capítulo**. Há um download por vez, em qualidade original (`data`), usando as URLs e a ordem retornadas por MangaDex@Home. Não há scraping, troca manual de servidor, autenticação em imagens ou contorno de recusa de acesso. Capítulos externos e sem páginas não oferecem download.

### Funcionamento

- Banner com páginas concluídas, bytes recebidos, progresso e cancelamento; acompanha a navegação entre detalhes e biblioteca.
- O download exige o app em primeiro plano. Ao ir para segundo plano, a transferência é cancelada e marcada como interrompida. Para repetir, o capítulo recomeça do início; não há retomada parcial nem serviço Android em segundo plano nesta versão.
- A transferência usa `expo/fetch` em blocos gravados por FileHandle, com timeout de 90 segundos por página. A validação lê uma imagem por vez, limitada a 24 MiB. O capítulo tem limite de 2 GiB, 5 mil páginas e 64 megapixels por imagem.
- Arquivos incompletos têm extensão `.part` e ficam em `download-staging/`. A biblioteca só recebe o item após todas as páginas serem validadas e publicadas em transação SQLite.
- Falhas temporárias de rede/HTTP 5xx permitem até três tentativas por página, com intervalo e nova consulta ao servidor indicado pela fonte. HTTP 403/404/429 não são repetidos automaticamente. A pausa de HTTP 429 é respeitada.
- URLs temporárias são renovadas antes de vencer; mudança de revisão do capítulo interrompe o processo para evitar misturar páginas de versões diferentes. Relatórios de sucesso/falha são enviados ao MangaDex@Home para nós de terceiros, conforme a documentação da fonte.
- Ao reabrir o app, registros de tentativas interrompidas são recuperados e seus arquivos próprios incompletos são limpos. Um capítulo concluído não é baixado novamente: a ação muda para **Ler offline**.
- Cada versão/grupo de tradução mantém seu ID de capítulo, seus créditos e progresso próprios. A biblioteca agrupa capítulos pelo ID da obra e pela fonte, com um cartão por título e a primeira página do primeiro capítulo como capa local. Ao tocar, os capítulos baixados aparecem na própria lista nesta etapa. CBZs e capítulos antigos sem identidade recuperável permanecem individuais; nomes parecidos não são usados para adivinhar relações.

### Armazenamento e compatibilidade

O SQLite migra as versões anteriores para a versão 5 em transação, preservando os CBZs, capítulos, página e modo de leitura existentes. A tabela `books` guarda fonte, ID do capítulo, créditos, ID/título da obra e número/idioma do capítulo; `downloads` registra a solicitação, estado, contagem e erros. Um índice único evita duplicação do mesmo capítulo da mesma fonte. A migração recupera a identidade das obras a partir das solicitações antigas válidas, conferindo ID do capítulo e vínculo com o livro. `page_reports` guarda relatórios pendentes e tentativas; `page_report_limits` persiste pausas solicitadas pelo servidor. A compatibilidade com bancos antigos sem a tabela de pausas permanece.

O padrão interno para downloads é uma pasta privada contendo `page-00001.ext`, `pages.json` (ordem) e `sizes.json` (dimensões). CBZs antigos continuam usando o índice ZIP original. O leitor oferece os mesmos modos e progresso para ambos; seu cache nunca remove as páginas permanentes dos downloads. Créditos de MangaDex e do grupo ficam disponíveis no leitor mesmo sem conexão.

Arquivos principais: `src/features/downloads/engine.ts`, `src/services/downloads/manager.ts`, `src/services/downloads/transfer.ts`, `src/providers/downloads.tsx`, `src/features/downloads/DownloadBanner.tsx`; integração nas rotas, cliente MangaDex, biblioteca e migração SQLite.

Referências oficiais consultadas: [obtenção de páginas](https://api.mangadex.org/docs/04-chapter/retrieving-chapter/), [limites da API](https://api.mangadex.org/docs/2-limitations/) e [Expo FileSystem](https://docs.expo.dev/versions/v58.0.0/sdk/filesystem/). Nenhuma dependência nova foi instalada.

### Testar no celular

Feche e reabra o app para executar a migração; não limpe os dados do aplicativo.

```powershell
npx expo start --go --clear
```

1. Confira se seus CBZs e progresso anteriores continuam na biblioteca.
2. Em Explorar, abra um título, escolha o idioma/grupo e toque em **Baixar capítulo**.
3. Aguarde com o app aberto, conferindo progresso e cancelamento. Quando concluir, toque em **Ler offline** e teste os dois modos.
4. Volte à biblioteca, ative modo avião e abra o capítulo salvo. Confira a restauração de progresso após fechar/reabrir o app.
5. Comece outro download e cancele. Ele não deve aparecer como leitura disponível. Teste também uma falha de conexão e a opção de tentar novamente.
6. Envie o app para segundo plano durante uma transferência; ao voltar, confira a indicação de interrupção. Em caso de fechamento forçado, reabra para a limpeza da tentativa incompleta.
7. Remova um capítulo concluído e confira que pode baixá-lo de novo.

Os testes usam páginas sintéticas, respostas de rede simuladas e SQLite real em memória. O filesystem nativo é simulado nas verificações integradas; a transferência real e o comportamento em segundo plano no Android ainda precisam de validação no dispositivo. Não houve download automático de páginas de obras do catálogo durante o desenvolvimento. O APK anterior não incorpora estas alterações: será necessário gerar outro após o teste no Expo Go.

Validação desta implementação: `npm run typecheck`, 42 testes e `npx expo export --platform android` passaram (bundle Hermes com 1.281 módulos). Os testes incluem migração/rollback em SQLite real, transferência em blocos simulada, publicação atômica, cancelamento, HTTP 429, renovação de manifesto, deduplicação e preservação das páginas permanentes no cache vertical. Não há lint configurado. A validação do download real no celular permanece pendente.

### Diagnóstico de lentidão dos downloads

Os relatórios MangaDex@Home usam uma fila persistente independente do download, com um envio ativo por vez. Pela política atual solicitada pelo usuário, somente capítulos encerrados com falha registram relatórios: são mantidas as tentativas de imagem que falharam e impediram a conclusão, no máximo três registros da página final. Páginas recuperadas em repetição, capítulos concluídos e cancelamentos não geram novos relatórios. O download não espera pela rede dos relatórios para publicar o capítulo ou iniciar outro. Cada envio mantém o timeout de 5 segundos. Falhas permitem até três tentativas de envio no total, com prazos de 30 e 120 segundos registrados antes do envio; filas longas e pausas do servidor podem aumentar os intervalos. HTTP 429 pausa a fonte pelo prazo informado e mantém a pausa após reabrir o app. Envios bem-sucedidos removem o registro; tentativas esgotadas ficam no banco e aparecem como sem novas tentativas. O worker carrega um relatório por vez, sem acumular imagens em RAM.

O aviso de conclusão ou falha oferece **Ver diagnóstico do download**: duração total, quantidade de tentativas de página, espera pelos cabeçalhos, leitura da rede, gravação, validação, fechamento da transferência, atualização dos arquivos/banco, publicação, consultas à fonte, pausas e espera dos relatórios. A mesma informação aparece no console com o prefixo `[Download]`, sem URLs temporárias. O diagnóstico fica somente na sessão atual; não é persistido no SQLite. Tempos dos relatórios se sobrepõem ao download e não devem ser somados ao total.

Para comparar, baixe novamente o mesmo capítulo depois de removê-lo da biblioteca (isso também remove seu progresso local). Mantenha o aplicativo aberto e, antes de fechar o aviso, abra o diagnóstico. Cache do servidor e condições de rede podem variar entre tentativas. Páginas bem-sucedidas avançam sem pausa artificial. Permanecem o download sequencial, o intervalo das consultas à API e as esperas de 2 e 4 segundos para repetir uma página após falhas temporárias. HTTP 429 continua interrompendo o download e estabelecendo a pausa exigida pela fonte.

Validação da otimização: TypeScript sem erros, 48 testes aprovados e exportação Android/Hermes concluída com 1.282 módulos. Os testes novos verificam páginas avançando com relatórios pendentes, limite de dois envios/quatro pendentes, esvaziamento da fila, tratamento de falha HTTP, relatório da tentativa cancelada e medição das pausas. Não há lint configurado. A comparação real de velocidade desta versão permanece pendente no celular.

Incremento após teste no APK (152,7 s para 59 páginas): removida a pausa artificial entre páginas bem-sucedidas. O diagnóstico agora agrupa falhas dos relatórios em timeout de 5 segundos, status HTTP, conexão/rede ou falha não identificada, sem expor URLs. Esses dados ainda precisam ser coletados no aparelho para determinar a causa das 59 falhas observadas; a fila limitada continua podendo adicionar espera. TypeScript e 51 testes passaram. Testar esta versão pelo Expo Go com `npx expo start --go --clear`, sem gerar novo APK.

Após comparar os logs de 48 páginas (312,9 s antes / 329,8 s depois), confirmou-se pausa artificial zerada e 48 timeouts dos relatórios, mas os tempos medidos ainda não explicam o total. O diagnóstico foi ampliado para preparação/criação/abertura dos arquivos, enfileiramento completo do relatório, atualizações de progresso e duração completa de cada página. Exibe também tempo residual dentro das páginas e tempo fora delas. Esses valores incluem etapas já detalhadas e não devem ser somados novamente. A causa do tempo residual e dos timeouts não foi determinada no aparelho; nenhuma melhoria adicional de velocidade é alegada. Testes: cobertura de relógio simulado para abertura/enfileiramento e diagnóstico integrado; 52 testes aprovados.

No teste seguinte (320,1 s / 48 páginas), 284,1 s ficaram dentro das páginas e fora das medições existentes; preparação/abertura e enfileiramento foram rápidos. A transferência agora tira um único snapshot de URL, status e cabeçalhos, evitando acessos repetidos aos getters nativos de FetchResponse (a implementação instalada do Expo recria Headers em cada acesso). O corpo também é acessado apenas uma vez. Foram adicionadas medições de metadados e preparação do stream ao diagnóstico e ao cálculo residual. As medidas de fetch/leitura/gravação agora usam try/finally ao redor do await, encerrando a medida quando a continuação realmente retoma, em vez de encerrá-la no callback de Promise.finally anterior à retomada. Isso cobre também possíveis atrasos de agendamento. São hipóteses de custo e correções de instrumentação; a causa dos 284,1 s e dos timeouts de relatórios ainda não foi confirmada no celular. Um teste com getters e relógio simulados verifica leitura única e contabilização dessas etapas.

Experimento solicitado: relatórios temporariamente desativados em `src/services/downloads/manager.ts` (`REPORTS_ENABLED = false`) para comparar o mesmo capítulo no Expo Go. A leitura em stream das imagens permanece igual; nenhuma alternativa de buffer nativo ou envio em lotes faz parte desta versão. A fonte continua expondo o envio de relatórios, mas o gerenciador não o chama durante o experimento. O diagnóstico mostra explicitamente a desativação. Essa configuração é apenas de investigação e deve ser revertida após avaliar o resultado; não é uma decisão de remover os relatórios do funcionamento normal. O teste integrado verifica zero chamadas mesmo com um remetente disponível.

Comparação sem relatórios: 330,8 s no total e 299,3 s em recebimento, próximos dos 338,1 s / 302,4 s com relatórios ativos. Isso enfraquece a hipótese de que relatórios sejam o gargalo principal; não identifica por si só servidor, rede ou streaming como causa.

Próximo experimento: o gerenciador prefere `Response.arrayBuffer()` nativo do Expo somente para imagens com Content-Length confiável, sem Content-Encoding de compressão, e tamanho de até 4 MiB (também respeita o limite restante do capítulo). Uma única imagem por vez fica em buffer; imagens maiores, sem tamanho ou respostas sem arrayBuffer usam o streaming anterior com limite durante a leitura. O tamanho efetivo é conferido antes de gravar; a validação da imagem, publicação transacional, tentativas limitadas e HTTP 429 permanecem. A espera JS pelo buffer pode ser cancelada mesmo se a promessa nativa não rejeitar após abort. Nesta modalidade, progresso em bytes avança ao receber a imagem inteira; o progresso por páginas continua disponível.

Os relatórios continuam temporariamente desativados para comparar apenas o método de leitura. O diagnóstico inclui contagem de páginas em buffer nativo e stream JS. O resultado deve ser coletado no Expo Go; não há ganho de velocidade confirmado. Validação: 58 testes aprovados, incluindo buffer sem inicializar stream JS, fallback para imagens grandes/comprimidas/sem tamanho, rejeição de tamanho incompatível, cancelamento, timeout e publicação integrada.

Estado atual após o experimento: relatórios reativados. A opção temporária `REPORTS_ENABLED` foi removida; a fila volta a usar o remetente da fonte quando disponível. Permanecem dois envios simultâneos, até quatro pendentes e timeout de 5 segundos. A leitura nativa de imagens pequenas permanece ativa, após o usuário medir 37,1 s para o mesmo capítulo de 48 páginas (antes: 330,8 s com streaming e sem relatórios). O diagnóstico exibe `Relatórios: ativados.`. O teste integrado verifica um envio por página e nenhum novo envio ao abrir uma solicitação de capítulo já salvo. Ainda é necessário testar no Expo Go a leitura nativa junto com os relatórios e investigar seus timeouts se persistirem.

### Fila persistente de relatórios — versão atual

A fila antiga que bloqueava o produtor foi substituída por `src/services/downloads/report-outbox.ts`. O gerenciador só aguarda o registro local de cada relatório e publica o capítulo após as validações, sem drenar a rede. A fila é recuperada ao abrir o app e processa registros enquanto ele está ativo; ao ir para segundo plano, não inicia novos envios. Um envio já iniciado pode terminar pelo seu timeout normal. Não foi criado serviço nativo de execução em segundo plano.

O diagnóstico do download mede a duração até a disponibilização do capítulo e informa quantos relatórios foram registrados e falhas de persistência. A situação atual da fila aparece separadamente: pendentes, sem novas tentativas, enviados nesta sessão e última falha. Após reabrir, se houver relatórios, o botão **Ver diagnóstico dos relatórios** permite conferir a fila recuperada mesmo sem novo download. Totais enviados nesta sessão não são um histórico permanente. Tentativas esgotadas permanecem salvas; não há repetição infinita nem descarte automático. Em caso de encerramento entre o envio e a confirmação no SQLite, um relatório pode ser repetido, sempre dentro do limite persistido de tentativas.

Teste no Expo Go com `npx expo start --go --clear`: feche e reabra o projeto para executar a migração, sem limpar dados. Confira biblioteca e progresso antigos; baixe o mesmo capítulo e abra a leitura assim que terminar, mesmo com relatórios pendentes. Inicie outro download para confirmar que a fila não o bloqueia. Feche/reabra o app com pendentes e confira o diagnóstico da fila. O servidor dos relatórios ainda pode expirar; a mudança evita aguardá-lo para concluir o download, sem prometer entrega ao endpoint indisponível.

Os testes usam SQLite real e rede simulada, incluindo dois capítulos concluindo com um relatório sem resposta, retomada, pausa, máximo de três tentativas e HTTP 429 persistido. Nenhuma dependência nova foi instalada.

Validação desta etapa: `npm run typecheck`, 64 testes e `npx expo export --platform android --output-dir .tmp/report-outbox-export` concluídos com sucesso (1.283 módulos Hermes). Não há lint configurado. A migração e os envios reais/retomada ainda devem ser conferidos no celular; nenhum APK novo foi gerado.

### Recuperação de fila com erro de processamento

O envio é disparado automaticamente ao recuperar a fila com o aplicativo ativo, ao registrar um relatório e ao vencer o temporizador da próxima tentativa. Ficar pendente não significa necessariamente ausência de tentativas: o registro permanece até o sucesso ou o esgotamento do limite. Reabrir o app respeita os prazos já persistidos.

Uma revisão inicial do banco v3 podia ter `page_reports` sem `page_report_limits`. O worker falhava ao consultar a pausa antes do envio, embora a contagem de pendentes continuasse funcionando. A migração v4 corrige esse cenário preservando registros, tentativas e pausas existentes. Esse cenário foi reproduzido em teste com 98 pendentes; a mensagem genérica mostrada anteriormente no aparelho não permite confirmar por si só que era a mesma causa. O diagnóstico agora exibe etapa e detalhe do erro (com URLs omitidas) e horário da próxima verificação, permitindo distinguir falha de processamento, espera programada e falha de envio. Testar após reiniciar o projeto no Expo Go, sem limpar seus dados.

### Política de relatórios após o diagnóstico HTTP 522

Por solicitação do usuário, o app registra relatórios apenas se o capítulo terminar com falha. O contrato da fonte permanece por imagem; os dados conservam o resultado real das tentativas de imagem que falharam, sem inventar um relatório agregado de capítulo. Quando uma página se recupera na repetição, seus erros transitórios são descartados. Cancelamentos e falhas sem tentativa de imagem disponível não produzem relatório. A fila mantém a política de um envio por vez e repetição limitada, independente do download.

Ao recuperar a fila, relatórios antigos com `success: true` são removidos em lotes de até 100 registros, inclusive os que esgotaram tentativas; os arquivos, progresso e capítulos são preservados. O produtor ignora sucessos e o consumidor também confere o resultado antes de enviar. A recomendação original da documentação MangaDex é reportar sucessos e falhas; o filtro de falhas é uma escolha explícita deste aplicativo pessoal solicitada pelo usuário.

Teste pelo Expo Go: reinicie o projeto com `npx expo start --go --clear`, sem limpar os dados. A fila antiga de sucessos será limpa automaticamente ao abrir. Baixe um capítulo válido e confirme `0 falhas de imagem registradas` no diagnóstico. Não é necessário provocar uma falha longa no celular: os testes cobrem capítulo com falha terminal (três tentativas registradas), falha recuperada (nenhum relatório), cancelamento e limpeza paginada dos sucessos antigos. TypeScript e 69 testes passaram.

### Biblioteca agrupada por mangá — primeira etapa

A tela inicial agora exibe um cartão por obra identificada (fonte + ID do mangá). Título, quantidade de capítulos, total de páginas e progresso para continuar são apresentados no cartão. Busca, ordenação e contagem dos filtros operam sobre as obras; capítulos em idiomas/grupos diferentes permanecem registros distintos. O menu da obra oferece continuar leitura e ver capítulos. O menu individual de cada capítulo conserva abertura e remoção com confirmação. Remover um capítulo não apaga os demais; removendo o último, o grupo desaparece naturalmente.

Nesta primeira etapa, tocar no cartão expande/recolhe capítulos dentro de uma única FlatList virtualizada. Não foi criada a nova página de detalhes. O capítulo em leitura intermediária mais recente tem prioridade para continuar; sem ele, escolhe-se o primeiro capítulo ainda não iniciado. O progresso mostrado pertence a esse capítulo, não é uma porcentagem agregada da obra. CBZs continuam como arquivos individuais, sem deduzir séries por nome.

O banco versão 5 adiciona metadados de agrupamento e recupera downloads antigos a partir do JSON da solicitação salva, sem trocar IDs nem mover arquivos. Pedidos ausentes, corrompidos ou que não correspondam ao capítulo deixam o item individual. Downloads novos gravam esses metadados junto com a publicação atômica do capítulo. Arquivos principais: `src/features/library/grouping.ts`, `LibraryMangaCard.tsx`, `LibraryChapterRow.tsx`, `src/storage/book-metadata.ts`, `src/storage/database.ts`, a tela inicial e o gerenciador de downloads.

Teste no Expo Go com `npx expo start --go --clear`: feche/reabra o projeto para executar a migração, sem limpar os dados. Confira se Boruto e outros títulos com vários capítulos aparecem uma única vez; expanda o cartão, abra os capítulos e confira a página/modo já salvos. Verifique busca, filtros e ordenação, e se um novo download entra no grupo existente. CBZs continuam abrindo diretamente no leitor. Os testes cobrem identidade de obra/fonte, traduções distintas, nomes iguais, ordem numérica, filtros, linhas virtualizadas, metadados de novos downloads e migração/rollback preservando progresso e arquivos referenciados.

Próximas etapas combinadas: página de detalhes com capítulos baixados e disponíveis para download, seguida das melhorias do leitor (navegação por gestos sem zonas de toque, deslocamento vertical e zoom). Essas alterações do leitor ainda não foram implementadas.

Validação do agrupamento: TypeScript sem erros, 77 testes aprovados e exportação Android/Hermes concluída com 1.286 módulos. Não há lint configurado. A apresentação e a interação da lista agrupada ainda precisam ser verificadas no celular. Nenhum APK novo foi gerado.
