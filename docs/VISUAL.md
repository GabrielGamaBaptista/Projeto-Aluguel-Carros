# VISUAL.md — Guia de Design Visual do AluguelCarrosApp

## PALETA DE CORES

### Cores primárias
| Nome | Hex | Uso |
|------|-----|-----|
| Primary | `#4F46E5` | Botões principais, tabs ativas, destaques |
| Primary Light | `#EEF2FF` | Background de cards de destaque |
| Primary Dark | `#3730A3` | Hover/pressed state |

### Cores de status
| Nome | Hex | Background | Uso |
|------|-----|------------|-----|
| Success | `#059669` | `#D1FAE5` | Aprovado, disponível, pago |
| Error | `#DC2626` | `#FEE2E2` | Erro, recusado, vencido |
| Warning | `#F59E0B` | `#FEF3C7` | Atenção, pendente, revisão |
| Info | `#3B82F6` | `#EFF6FF` | Informação geral |

### Cores de superfície
| Nome | Hex | Uso |
|------|-----|-----|
| Background | `#F3F4F6` | Fundo das telas |
| Surface | `#FFFFFF` | Cards, modais |
| Border | `#E5E7EB` | Divisores, bordas de input |

### Cores de texto
| Nome | Hex | Uso |
|------|-----|-----|
| Text Primary | `#1F2937` | Título, texto principal |
| Text Secondary | `#6B7280` | Subtítulo, label |
| Text Muted | `#9CA3AF` | Placeholder, data, hint |

### Cores por tipo de tarefa
| Tipo | Hex | Uso |
|------|-----|-----|
| km_update | `#3B82F6` | Atualização de KM |
| photo_inspection | `#8B5CF6` | Inspeção fotográfica |
| oil_change | `#F59E0B` | Troca de óleo |
| maintenance | `#059669` | Manutenção |

---

## TIPOGRAFIA

- **Fonte**: System default (San Francisco no iOS, Roboto no Android)
- **Hierarquia recomendada**:
  - Title da tela: 20-22px, weight 700
  - Section header: 16px, weight 600
  - Body: 14-15px, weight 400
  - Caption / label: 12-13px, weight 400, color Text Secondary
  - Badge / chip: 11-12px, weight 600

---

## BIBLIOTECA DE ÍCONES — `lucide-react-native`

### Por que Lucide?
- Usa `react-native-svg` (já instalado no projeto) — sem configuração nativa extra
- Traço único e consistente (1.5px stroke, linha limpa)
- Tamanho e cor configuráveis por prop
- Zero dependência de fontes externas
- Design system moderno e profissional

### Instalação
```bash
npm install lucide-react-native
npm install react-native-vector-icons
```

**lucide-react-native**: não requer configuração adicional (usa `react-native-svg` já instalado).

**react-native-vector-icons**: requer configuração no Android. Adicionar em `android/app/build.gradle`:
```gradle
apply from: "../../node_modules/react-native-vector-icons/fonts.gradle"
```
Usado apenas para o ícone `car` (MaterialCommunityIcons) na tab de Carros.

### Padrões de uso
```tsx
import { Car, ClipboardList, CreditCard } from 'lucide-react-native';

// Tamanho padrão para tabs de navegação
<Car size={22} color={color} />

// Tamanho padrão para ícones de seção/card
<Car size={20} color="#4F46E5" />

// Tamanho padrão para ícones de ação/botão
<Car size={18} color="#6B7280" />

// Ícone em container colorido (tipo tarefa)
<View style={{ backgroundColor: '#3B82F620', padding: 8, borderRadius: 8 }}>
  <Gauge size={18} color="#3B82F6" />
</View>
```

---

## MAPEAMENTO EMOJI → ÍCONE LUCIDE

### Tabs de Navegação (App.tsx)
| Emoji atual | Ícone | Biblioteca | Import | Tab |
|-------------|-------|------------|--------|-----|
| 🚗 | `car` | `react-native-vector-icons/MaterialCommunityIcons` | `MaterialCommunityIcons` | Carros |
| 📋 | `ClipboardList` | `lucide-react-native` | `lucide-react-native` | Tarefas |
| 💳 | `cash` | `react-native-vector-icons/MaterialCommunityIcons` | `MaterialCommunityIcons` | Pagamentos |
| 📢 | `Megaphone` | `lucide-react-native` | `lucide-react-native` | Mural |
| 💰 | `BarChart3` | `lucide-react-native` | `lucide-react-native` | Financeiro |
| 👤 | `User` | `lucide-react-native` | `lucide-react-native` | Perfil |

### Tipos de Tarefa (TasksScreen, CarDetailsScreen)
| Emoji atual | Ícone Lucide | Import | Tipo |
|-------------|-------------|--------|------|
| 📍 | `Gauge` | `lucide-react-native` | km_update |
| 📸 | `Camera` | `lucide-react-native` | photo_inspection |
| 🛢 | `Droplets` | `lucide-react-native` | oil_change |
| 🔧 | `Wrench` | `lucide-react-native` | maintenance |

### Ações e Status (vários screens)
| Emoji atual | Ícone Lucide | Import | Contexto |
|-------------|-------------|--------|----------|
| 🔔 | `Bell` | `lucide-react-native` | Notificações / solicitações |
| ⚠️ | `AlertTriangle` | `lucide-react-native` | Atenção / revisão |
| ✅ | `CheckCircle2` | `lucide-react-native` | Aprovado |
| 👁️ | `Eye` | `lucide-react-native` | Em revisão |
| 🔍 | `Search` | `lucide-react-native` | Busca |
| 🔒 | `Lock` | `lucide-react-native` | Alterar senha |
| 🚪 | `LogOut` | `lucide-react-native` | Sair |
| 📧 | `Mail` | `lucide-react-native` | Email |
| 📞 | `Phone` | `lucide-react-native` | Telefone |
| 💬 | `MessageCircle` | `lucide-react-native` | Mensagem |
| 📎 | `Paperclip` | `lucide-react-native` | Documento |
| 🎉 | `PartyPopper` | `lucide-react-native` | Conclusão de cadastro |
| 📄 | `FileText` | `lucide-react-native` | Contrato / documento |
| 📌 | `pin` | `react-native-vector-icons/MaterialCommunityIcons` | Post fixado no mural |
| 📷 | `Camera` | `lucide-react-native` | Permissão de câmera |
| 🔋 | `Battery` | `lucide-react-native` | Otimização de bateria |
| 🏢 | `Building2` | `lucide-react-native` | Pessoa Jurídica |
| 🛡️ | `ShieldCheck` | `lucide-react-native` | Segurança / onboarding |

### Estados Vazios (empty states)
| Contexto | Ícone Lucide | Cor sugerida |
|----------|-------------|--------------|
| Sem carros | `Car` | `#9CA3AF` |
| Sem tarefas | `ClipboardList` | `#9CA3AF` |
| Sem cobranças | `CreditCard` | `#9CA3AF` |
| Sem contratos | `FileText` | `#9CA3AF` |
| Sem posts no mural | `Megaphone` | `#9CA3AF` |
| Busca sem resultado | `SearchX` | `#9CA3AF` |

---

## ESTILO DE CARDS E COMPONENTES

### Card padrão
```
backgroundColor: #FFFFFF
borderRadius: 12
padding: 16
elevation: 2 (Android) / shadow leve (iOS)
borderColor: #E5E7EB (apenas se necessário)
```

### Badge de status
```
borderRadius: 6
paddingVertical: 3
paddingHorizontal: 8
fontSize: 12
fontWeight: 600
```

### Botão primário
```
backgroundColor: #4F46E5
borderRadius: 10
paddingVertical: 14
fontSize: 15
fontWeight: 600
color: #FFFFFF
```

### Botão secundário / outline
```
borderColor: #4F46E5
borderWidth: 1.5
borderRadius: 10
paddingVertical: 13
fontSize: 15
fontWeight: 600
color: #4F46E5
```

### Input
```
backgroundColor: #F9FAFB
borderColor: #E5E7EB
borderWidth: 1
borderRadius: 8
paddingHorizontal: 12
paddingVertical: 10
fontSize: 15
color: #1F2937
```

### Container de ícone colorido (tipo tarefa)
```
width: 36
height: 36
borderRadius: 8
backgroundColor: COR_DA_TAREFA + '20'  (ex: '#3B82F620')
alignItems: center
justifyContent: center
```

---

## CONVENÇÕES DE TAMANHO DE ÍCONES

| Contexto | Tamanho | Cor padrão |
|----------|---------|------------|
| Tab bar (ativo) | 22 | `#4F46E5` |
| Tab bar (inativo) | 22 | `#9CA3AF` |
| Card / seção | 20 | cor do contexto |
| Botão de ação | 18 | `#6B7280` ou branco |
| Dentro de container colorido | 18 | cor sólida do tema |
| Empty state | 48 | `#D1D5DB` |
| Header / título de tela | 20 | `#4F46E5` |

---

## CHECKLIST DE MIGRAÇÃO

### Fase 1 — Tabs de navegação (impacto visual imediato)
- [ ] Instalar `lucide-react-native`
- [ ] Substituir emojis nas 6 tabs em `App.tsx`

### Fase 2 — Tipos de tarefa (recorrentes em múltiplas telas)
- [ ] `getTaskIcon()` em `TasksScreen.tsx`
- [ ] `getTaskIcon()` em `CarDetailsScreen.tsx`
- [ ] Modal de criação de tarefas em `CarDetailsScreen.tsx`

### Fase 3 — Status e ações
- [ ] Banners de status em `TaskDetailsScreen.tsx` (👁️ ⚠️ ✅)
- [ ] Botões de ação em `ProfileScreen.tsx` (🔒 🚪)
- [ ] Contatos em `TenantDetailsScreen.tsx` (📞 💬 📧)

### Fase 4 — Telas de onboarding e states vazios
- [ ] `PermissionsScreen.tsx` (🔔 📷 🔋)
- [ ] `RegisterScreen.tsx` / `GoogleCompleteProfileScreen.tsx` (🏢 👤 🎉)
- [ ] Empty states em HomeScreen, MuralManagerScreen, AssignTenantScreen

### Fase 5 — Componentes
- [ ] `DocumentPicker.tsx` (📎)
- [ ] `EmailVerificationScreen.tsx` (📧)
