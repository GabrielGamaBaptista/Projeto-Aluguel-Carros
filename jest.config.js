module.exports = {
  preset: 'react-native',
  // O preset react-native so transforma react-native e @react-native.
  // @react-navigation v7 distribui ESM puro (main aponta para lib/module/),
  // entao precisa ser transpilado pelo Babel tambem.
  // O preset react-native ignora todos os node_modules exceto react-native
  // e @react-native. Isso nao cobre:
  //   - react-native-* (ex: react-native-flash-message, react-native-safe-area-context)
  //     cujo main aponta para src/ com import/export
  //   - @react-navigation/* v7 (distribui ESM puro)
  // O padrao [^/]* garante que react-native-foo-bar tambem e transformado.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native[^/]*|@react-native[^/]*|@react-navigation[^/]*)\/)',
  ],
};
