import { View, Text, TouchableOpacity, ScrollView, SafeAreaView } from '../components/Theme';
/**
 * ImportScreen.js
 * Bulk import transactions from:
 *   • Excel / CSV bank statements
 *   • PDF bank statements (via WebView + PDF.js)
 *   • Manual bulk entry
 * All imports go through DeduplicationEngine to prevent conflicts.
 */

import React, { useState, useRef } from 'react';
import { StyleSheet, Alert, ActivityIndicator, FlatList, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import WebView from 'react-native-webview';
import AsyncStorage from '../data/Storage';
import { putAccount } from '../data/Collections';
import { prepareStatementWallets, newAccountId } from '../utils/AccountResolver';
import { walletFields } from '../utils/WalletAccounts';
import {
  pickAndParseStatement,
  buildPdfParserHtml,
  parsePdfText,
  saveStatementTransactions,
} from '../utils/StatementParser';
const COLORS = {
  primary: '#2196F3',
  success: '#4CAF50',
  warning: '#FF9800',
  danger: '#F44336',
  bg: '#F5F7FA',
  card: '#FFFFFF',
  text: '#1A1A2E',
  sub: '#6B7280',
  border: '#E5E7EB',
};
export default function ImportScreen({ navigation }) {
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState('idle'); // idle | parsing | preview | saving | done
  const [parsedTxs, setParsedTxs] = useState([]);
  const [stats, setStats] = useState({
    added: 0,
    skipped: 0,
  });
  // Off by default: a statement's rows are usually already reflected in the account balance
  const [adjustBalances, setAdjustBalances] = useState(false);
  const [pdfHtml, setPdfHtml] = useState(null);
  const [pdfBankHint, setPdfBankHint] = useState('');
  const webViewRef = useRef(null);

  // ── Handlers ────────────────────────────────────────────────────────────

  const handlePickFile = async () => {
    setLoading(true);
    try {
      const result = await pickAndParseStatement((base64, uri) => {
        // PDF picked — launch WebView parser
        const html = buildPdfParserHtml(base64);
        setPdfHtml(html);
        const name = uri.split('/').pop().toLowerCase();
        setPdfBankHint(detectBankHint(name));
        setPhase('parsing');
        setLoading(false);
      });
      if (result.canceled) {
        setLoading(false);
        return;
      }
      if (result.type === 'excel') {
        setLoading(false);
        if (result.error) {
          Alert.alert('Parse Error', result.error);
          return;
        }
        if (!result.transactions || result.transactions.length === 0) {
          Alert.alert('No Data', 'No transactions found. Check the file format.');
          return;
        }
        setParsedTxs(result.transactions);
        setPhase('preview');
      }
    } catch (err) {
      setLoading(false);
      Alert.alert('Error', err.message);
    }
  };
  const detectBankHint = (name) => {
    if (/hdfc/i.test(name)) return 'HDFC Bank';
    if (/icici/i.test(name)) return 'ICICI Bank';
    if (/sbi/i.test(name)) return 'SBI';
    if (/axis/i.test(name)) return 'Axis Bank';
    return 'Bank';
  };

  // Called by WebView when PDF text is extracted
  const onWebViewMessage = (event) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'PDF_TEXT') {
        const txs = parsePdfText(msg.text, pdfBankHint);
        setPdfHtml(null);
        if (txs.length === 0) {
          Alert.alert(
            'No Transactions Found',
            'Could not extract transactions from this PDF.\n\nTips:\n• Try converting to Excel first\n• Ensure it is a text-based (not scanned) PDF'
          );
        } else {
          setParsedTxs(txs);
          setPhase('preview');
        }
      } else if (msg.type === 'error') {
        setPdfHtml(null);
        setPhase('idle');
        Alert.alert('PDF Error', msg.msg);
      }
    } catch (_) {}
  };
  // A5: link UPI Lite rows to the wallet; if there is none, ASK before creating one
  const prepareRows = async () => {
    const accounts = JSON.parse((await AsyncStorage.getItem('user_wealth_accounts')) || '[]');
    const accountName = parsedTxs[0]?.account || '';
    const first = prepareStatementWallets(parsedTxs, accounts, accountName);
    if (!first.missingWallet) return first.rows;
    const create = await new Promise((resolve) =>
      Alert.alert(
        'Create wallet account?',
        `This statement has UPI Lite top-ups from ${first.bank.name}. Create a "UPI Lite" wallet linked to it so they count as transfers into the wallet?`,
        [
          { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Create', onPress: () => resolve(true) },
        ]
      )
    );
    if (!create) return first.rows;
    const wallet = {
      id: newAccountId(),
      ...first.missingWallet,
      ...walletFields({ name: 'UPI Lite', walletSubType: 'UPI Lite', linkedBankId: first.bank.id }),
      balance: 0,
    };
    await putAccount(wallet);
    return prepareStatementWallets(parsedTxs, [...accounts, wallet], accountName).rows;
  };
  const handleConfirmImport = async () => {
    setPhase('saving');
    try {
      const rows = await prepareRows();
      const { added, skipped } = await saveStatementTransactions(rows, {
        balanceMode: adjustBalances ? 'delta' : 'none',
      });
      setStats({
        added,
        skipped,
      });
      setPhase('done');
    } catch (err) {
      setPhase('idle');
      Alert.alert('Save Error', err.message);
    }
  };
  const resetState = () => {
    setParsedTxs([]);
    setPdfHtml(null);
    setPhase('idle');
    setLoading(false);
  };

  // ── Render helpers ───────────────────────────────────────────────────────

  const TypeBadge = ({ type }) => (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: type === 'income' ? '#E8F5E9' : '#FFEBEE',
        },
      ]}
    >
      <Text
        style={[
          styles.badgeText,
          {
            color: type === 'income' ? COLORS.success : COLORS.danger,
          },
        ]}
      >
        {type === 'income' ? '+ Income' : '− Expense'}
      </Text>
    </View>
  );

  // ── Screens ──────────────────────────────────────────────────────────────

  if (pdfHtml && phase === 'parsing') {
    return (
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: '#000',
        }}
      >
        <View style={styles.pdfOverlay}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.pdfText}>Extracting transactions from PDF…</Text>
          <Text style={styles.pdfSub}>This may take a few seconds</Text>
        </View>
        <WebView
          ref={webViewRef}
          source={{
            html: pdfHtml,
          }}
          onMessage={onWebViewMessage}
          onError={() => {
            setPdfHtml(null);
            setPhase('idle');
            Alert.alert(
              'PDF Error',
              'Could not load the PDF reader. Check your internet connection and try again.'
            );
          }}
          style={{
            height: 0,
            width: 0,
          }}
          originWhitelist={['*']}
          javaScriptEnabled
        />
      </SafeAreaView>
    );
  }
  if (phase === 'done') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.doneContainer}>
          <Ionicons name="checkmark-circle" size={72} color={COLORS.success} />
          <Text style={styles.doneTitle}>Import Complete!</Text>
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={styles.statNum}>{stats.added}</Text>
              <Text style={styles.statLabel}>Added</Text>
            </View>
            <View
              style={[
                styles.statCard,
                {
                  backgroundColor: '#FFF3E0',
                },
              ]}
            >
              <Text
                style={[
                  styles.statNum,
                  {
                    color: COLORS.warning,
                  },
                ]}
              >
                {stats.skipped}
              </Text>
              <Text style={styles.statLabel}>Skipped (Duplicates)</Text>
            </View>
          </View>
          <Text style={styles.doneNote}>Duplicate transactions were automatically skipped.</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={resetState}>
            <Text style={styles.primaryBtnText}>Import Another File</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.outlineBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.outlineBtnText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }
  if (phase === 'preview') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={resetState}>
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Preview ({parsedTxs.length} transactions)</Text>
          <TouchableOpacity onPress={handleConfirmImport} style={styles.confirmBtn}>
            <Text style={styles.confirmBtnText}>Import All</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.previewSummary}>
          <Text style={styles.previewSumText}>
            Total: {parsedTxs.length} transactions | Income:{' '}
            {parsedTxs.filter((t) => t.type === 'income').length} | Expense:{' '}
            {parsedTxs.filter((t) => t.type === 'expense').length}
          </Text>
        </View>

        <View style={styles.adjustRow}>
          <View
            style={{
              flex: 1,
              paddingRight: 12,
            }}
          >
            <Text style={styles.adjustTitle}>Adjust account balances</Text>
            <Text style={styles.adjustSub}>
              Leave off if your balances already include these transactions.
            </Text>
          </View>
          <Switch
            value={adjustBalances}
            onValueChange={setAdjustBalances}
            trackColor={{
              true: COLORS.primary,
            }}
          />
        </View>

        <FlatList
          data={parsedTxs}
          keyExtractor={(_, i) => String(i)}
          contentContainerStyle={{
            paddingBottom: 20,
          }}
          renderItem={({ item }) => (
            <View style={styles.txRow}>
              <View
                style={{
                  flex: 1,
                }}
              >
                <Text style={styles.txTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={styles.txDate}>
                  {item.date} · {item.account}
                </Text>
                <Text style={styles.txCat}>{item.category}</Text>
              </View>
              <View
                style={{
                  alignItems: 'flex-end',
                }}
              >
                <Text
                  style={[
                    styles.txAmount,
                    {
                      color: item.type === 'income' ? COLORS.success : COLORS.danger,
                    },
                  ]}
                >
                  {item.type === 'income' ? '+' : '−'}₹{item.amount.toLocaleString('en-IN')}
                </Text>
                <TypeBadge type={item.type} />
              </View>
            </View>
          )}
        />
      </SafeAreaView>
    );
  }

  // Default idle screen
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Import Transactions</Text>
        <View
          style={{
            width: 24,
          }}
        />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Hero */}
        <View style={styles.heroCard}>
          <Ionicons name="cloud-upload-outline" size={48} color={COLORS.primary} />
          <Text style={styles.heroTitle}>Bulk Import</Text>
          <Text style={styles.heroSub}>
            Import your bank statements from Excel, CSV, or PDF. Duplicates are auto-skipped.
          </Text>
        </View>

        {/* Supported formats */}
        <Text style={styles.sectionTitle}>Supported Formats</Text>

        {[
          {
            icon: 'document-text',
            color: '#4CAF50',
            label: 'Excel / CSV (.xlsx, .csv)',
            desc: 'HDFC, SBI, ICICI, Axis, Kotak and most Indian banks',
          },
          {
            icon: 'document-attach',
            color: '#F44336',
            label: 'PDF Bank Statement',
            desc: 'Text-based PDFs — not scanned images',
          },
          {
            icon: 'phone-portrait',
            color: '#9C27B0',
            label: 'UPI Apps (via Excel)',
            desc: 'Export CSV from PhonePe, GPay, Paytm and import here',
          },
        ].map((f, i) => (
          <View key={i} style={styles.formatRow}>
            <View
              style={[
                styles.formatIcon,
                {
                  backgroundColor: f.color + '20',
                },
              ]}
            >
              <Ionicons name={f.icon} size={22} color={f.color} />
            </View>
            <View
              style={{
                flex: 1,
              }}
            >
              <Text style={styles.formatLabel}>{f.label}</Text>
              <Text style={styles.formatDesc}>{f.desc}</Text>
            </View>
          </View>
        ))}

        {/* Supported banks */}
        <Text style={styles.sectionTitle}>Supported Banks</Text>
        <View style={styles.banksGrid}>
          {[
            'HDFC',
            'SBI',
            'ICICI',
            'Axis',
            'Kotak',
            'PNB',
            'Yes Bank',
            'IndusInd',
            'IDFC',
            'BOB',
            'Canara',
            'Union Bank',
            'Federal',
            'PhonePe',
            'GPay',
            'Paytm',
          ].map((b) => (
            <View key={b} style={styles.bankChip}>
              <Text style={styles.bankChipText}>{b}</Text>
            </View>
          ))}
        </View>

        {/* Tips */}
        <View style={styles.tipCard}>
          <Ionicons name="bulb-outline" size={18} color={COLORS.warning} />
          <View
            style={{
              flex: 1,
              marginLeft: 8,
            }}
          >
            <Text style={styles.tipTitle}>Tips for best results</Text>
            <Text style={styles.tipText}>
              • Download statement directly from your bank&apos;s app/website
            </Text>
            <Text style={styles.tipText}>• Use Excel format when PDF extraction fails</Text>
            <Text style={styles.tipText}>• Don&apos;t rename the file — bank name is auto-detected</Text>
          </View>
        </View>

        {/* Import button */}
        <TouchableOpacity style={styles.importBtn} onPress={handlePickFile} disabled={loading}>
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="folder-open-outline" size={22} color="#fff" />
              <Text style={styles.importBtnText}>Select Bank Statement File</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
  },
  scroll: {
    padding: 16,
    paddingBottom: 40,
  },
  heroCard: {
    backgroundColor: '#E3F2FD',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 20,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.text,
    marginTop: 12,
    marginBottom: 6,
  },
  heroSub: {
    fontSize: 13,
    color: COLORS.sub,
    textAlign: 'center',
    lineHeight: 18,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 10,
    marginTop: 4,
  },
  formatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    gap: 12,
  },
  formatIcon: {
    width: 42,
    height: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  formatLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  formatDesc: {
    fontSize: 12,
    color: COLORS.sub,
    marginTop: 2,
  },
  banksGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  bankChip: {
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  bankChipText: {
    fontSize: 12,
    color: COLORS.text,
    fontWeight: '500',
  },
  tipCard: {
    flexDirection: 'row',
    backgroundColor: '#FFF8E1',
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
  },
  tipTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#E65100',
    marginBottom: 4,
  },
  tipText: {
    fontSize: 12,
    color: '#5D4037',
    marginBottom: 2,
  },
  importBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    padding: 16,
    gap: 10,
  },
  importBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  // Preview
  previewSummary: {
    backgroundColor: '#E3F2FD',
    padding: 12,
    marginHorizontal: 0,
  },
  adjustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: '#EEE',
  },
  adjustTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#222',
  },
  adjustSub: {
    fontSize: 12,
    color: '#777',
    marginTop: 2,
  },
  previewSumText: {
    fontSize: 13,
    color: COLORS.primary,
    fontWeight: '600',
    textAlign: 'center',
  },
  confirmBtn: {
    backgroundColor: COLORS.success,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
  },
  confirmBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  txRow: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    marginHorizontal: 12,
    marginVertical: 4,
    borderRadius: 12,
    padding: 14,
  },
  txTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  txDate: {
    fontSize: 12,
    color: COLORS.sub,
    marginTop: 2,
  },
  txCat: {
    fontSize: 11,
    color: COLORS.primary,
    marginTop: 2,
  },
  txAmount: {
    fontSize: 15,
    fontWeight: '700',
  },
  badge: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 4,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  // Done screen
  doneContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  doneTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: COLORS.text,
    marginTop: 16,
    marginBottom: 24,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 16,
  },
  statCard: {
    backgroundColor: '#E8F5E9',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    minWidth: 120,
  },
  statNum: {
    fontSize: 32,
    fontWeight: '800',
    color: COLORS.success,
  },
  statLabel: {
    fontSize: 13,
    color: COLORS.sub,
    marginTop: 4,
  },
  doneNote: {
    fontSize: 13,
    color: COLORS.sub,
    textAlign: 'center',
    marginBottom: 24,
  },
  primaryBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    padding: 16,
    width: '100%',
    alignItems: 'center',
    marginBottom: 10,
  },
  primaryBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  outlineBtn: {
    borderWidth: 2,
    borderColor: COLORS.primary,
    borderRadius: 14,
    padding: 14,
    width: '100%',
    alignItems: 'center',
  },
  outlineBtnText: {
    color: COLORS.primary,
    fontWeight: '700',
    fontSize: 15,
  },
  // PDF overlay
  pdfOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  pdfText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 16,
  },
  pdfSub: {
    fontSize: 13,
    color: COLORS.sub,
    marginTop: 6,
  },
});
