# NAVEGAÇÃO E COMPONENTES REUTILIZÁVEIS

> Parte da documentação modularizada do CLAUDE.md. Consultar ao adicionar telas ou usar componentes compartilhados.

---

## Bottom Tabs

| Tab | Tela | Visível para |
|-----|------|-------------|
| Carros | HomeScreen | Ambos |
| Tarefas | TasksScreen | Ambos |
| Pagamentos | TenantPaymentsScreen | Só locatário |
| Mural | MuralManagerScreen | Só locador |
| Financeiro | FinancialDashboardScreen | Só locador |
| Perfil | ProfileScreen | Ambos |

**Nota**: `AddCarScreen` foi removido das tabs — está acessível via card na HomeScreen (locador) como stack screen.

---

## Stack Screens (dentro do app autenticado)

- `CarDetailsScreen` — detalhes + ações do carro
- `EditCarScreen` — editar dados do carro
- `AddCarScreen` — adicionar novo carro
- `AssignTenantScreen` — buscar + enviar solicitação de vínculo
- `TaskDetailsScreen` — ver + completar + aprovar tarefa
- `TenantDetailsScreen` — dados completos do locatário (PII via `getTenantDetailsCF`)
- `ContractDetailsScreen` — detalhes + edição de contrato
- `PaymentContractScreen` — criar novo contrato de aluguel
- `ChargesScreen` — criar cobrança avulsa
- `PaymentDetailsScreen` — detalhes de uma cobrança, QR PIX
- `VehicleHistoryScreen` — histórico do veículo
- `AddExpenseScreen` — registrar despesa do veículo

---

## Componentes Reutilizáveis

### `ImageViewer`
Modal fullscreen com zoom (pinch-to-zoom), compartilhamento e download.
```tsx
<ImageViewer visible={bool} imageUrl={string} title={string} onClose={() => void} />
```

### `PhotoPicker`
Componente que abre câmera ou galeria, faz upload para Cloudinary, retorna URL.
```tsx
<PhotoPicker label={string} onPhotoSelected={(url: string) => void} currentPhotoUrl={string|null} />
```

### `PdfViewer`
Visualizador de PDF inline.

### `DocumentPicker`
Seleção de documentos PDF para upload.

### `MdiIcons` (`src/components/icons/MdiIcons.tsx`)
Wrapper legado para ícones Material Design. **Para novos componentes, usar `lucide-react-native`** (padrão atual do projeto).

---

## Componentes Financeiros (`src/components/financial/`)

| Componente | Descrição |
|-----------|-----------|
| `FinancialDataContext.tsx` | Contexto compartilhado (contratos + cobranças + filtros persistentes) |
| `ResumoTab.tsx` | Cards de totais + BarChart últimos 6 meses |
| `ContratosTab.tsx` | Lista contratos → navega para ContractDetails; badge ⚠️ para erro recorrente |
| `CobrancasTab.tsx` | Lista cobranças com filtros por carro e status |
| `DespesasTab.tsx` | Lista e registro de despesas do veículo |
