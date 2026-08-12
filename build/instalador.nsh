; Grava o idioma escolhido no assistente onde o app consegue ler.
;
; O assistente já é multilíngue, mas o NSIS usa a escolha só nos textos dele:
; sem isto, quem instala em inglês abre o app em português assim mesmo.
;
; O arquivo vai para `%APPDATA%\<pacote>`, que é o `userData` do Electron — o
; mesmo lugar do `config.json` — e não para o `$INSTDIR`. A atualização
; automática roda o desinstalador antigo, que faz `RMDir /r $INSTDIR`: qualquer
; coisa nossa deixada lá sumiria a cada versão nova.
!macro customInstall
  ; A atualização silenciosa reexecuta este instalador sem mostrar o seletor, e
  ; aí `$LANGUAGE` é só o padrão do build — não o que o usuário escolheu um dia.
  ; Escrever aqui apagaria a escolha dele sem nem mostrar uma tela.
  ${ifNot} ${isUpdated}
    Push $0
    Push $1

    ; Instalação para todos os usuários deixa o contexto em "all", e aí $APPDATA
    ; apontaria para o ProgramData. O Electron sempre lê o AppData do usuário.
    ${if} $installMode == "all"
      SetShellVarContext current
    ${endif}

    ; Sem o pt_BR em `installerLanguages`, `${LANG_PORTUGUESEBR}` não existiria e
    ; o NSIS compararia com o texto literal — o app sairia sempre em inglês, e a
    ; build passaria sem dizer nada. Melhor quebrar aqui.
    !ifndef LANG_PORTUGUESEBR
      !error "instalador.nsh: falta pt_BR em nsis.installerLanguages"
    !endif

    ${if} $LANGUAGE == ${LANG_PORTUGUESEBR}
      StrCpy $0 "pt"
    ${else}
      StrCpy $0 "en"
    ${endif}

    ; A pasta pode não existir ainda: numa instalação nova o app nunca rodou.
    CreateDirectory "$APPDATA\${APP_PACKAGE_NAME}"
    ClearErrors
    FileOpen $1 "$APPDATA\${APP_PACKAGE_NAME}\idioma.txt" w
    ${ifNot} ${Errors}
      FileWrite $1 $0
      FileClose $1
    ${endif}

    ${if} $installMode == "all"
      SetShellVarContext all
    ${endif}

    Pop $1
    Pop $0
  ${endIf}
!macroend
