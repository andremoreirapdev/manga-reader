# MangaReader — primeira etapa offline

Aplicativo pessoal exclusivamente Android. Expo SDK 58, React Native 0.88, React 19.3, TypeScript estrito, Expo Router, SQLite e arquivos privados. Sem backend ou MangaDex.

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
