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

Arquivos: `app/index.tsx`, componentes e seletores em `src/features/library/`, testes em `tests/library-selectors.test.ts`. Nenhuma dependência, migração de banco ou comportamento do leitor foi adicionado nesta mudança. O download de capítulos continua pendente.

Validação executada: TypeScript, 20 testes e bundle Hermes Android passaram. Não há lint configurado no projeto. A aparência e a interação final precisam ser conferidas no celular:

```powershell
npx expo start --go
```

Confira biblioteca vazia, cards com títulos longos, busca por acentos, filtro Em leitura, ordenação, importação, menu de remoção e navegação para o catálogo. O APK já instalado não recebe essa alteração automaticamente; uma nova compilação será necessária para incorporar o layout fora do Expo Go.

### Menus da biblioteca

Menu do item, ordenação e confirmação de remoção usam o componente `src/features/library/LibraryActionSheet.tsx`, com painel inferior escuro, ações de remoção em vermelho e indicação da ordenação selecionada. Toque fora, botão Fechar/Cancelar ou Voltar do Android fecham o painel. O fluxo de confirmação permanece obrigatório antes de apagar um item. Não há novas dependências.
