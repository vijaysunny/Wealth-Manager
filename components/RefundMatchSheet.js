/**
 * RefundMatchSheet (Phase 14 E5, docs/design/26-refund-match.png): which purchase is this refund
 * for? Candidates best first, "What changes", Not a refund / Link refund.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useTokens } from './Theme';
import { fonts, radius, space } from './tokens';
import { AppButton } from './ui';
import { candidates, refundCategoryOf } from '../utils/RefundMatch';
import { payeeOf } from '../utils/PayeeMatch';
import { shortAccountName } from '../utils/TransactionList';
import { formatMoney } from '../utils/Format';

const day = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const month = (iso) => new Date(iso).toLocaleDateString('en-GB', { month: 'long' });

export default function RefundMatchSheet({
  visible,
  refund,
  txs,
  accountsById = {},
  busy,
  onLink,
  onNotRefund,
  onClose,
}) {
  const t = useTokens();
  const list = useMemo(() => (visible && refund ? candidates(refund, txs) : []), [visible, refund, txs]);
  const [pick, setPick] = useState(null);
  useEffect(() => setPick(list[0]?.tx.id ?? null), [list]);
  if (!refund) return null;
  const chosen = list.find((c) => c.tx.id === pick);
  const acc = accountsById[String(refund.accountId)];
  const where = [acc ? shortAccountName(acc.name, acc.last4) : refund.account, day(refund.fullDate)]
    .filter(Boolean)
    .join(' · ');
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(14,23,38,0.45)' }}
      />
      <View
        style={{
          backgroundColor: t.card,
          borderTopLeftRadius: radius.xxl,
          borderTopRightRadius: radius.xxl,
          padding: space.xl,
          maxHeight: '85%',
        }}
      >
        <ScrollView>
          <Text accessibilityRole="header" style={{ color: t.text, fontFamily: fonts.display, fontSize: 22 }}>
            {`Refund of ${formatMoney(refund.amount)} from ${payeeOf(refund)}`}
          </Text>
          <Text
            style={{
              color: t.text2,
              fontFamily: fonts.body,
              fontSize: 15,
              marginTop: space.xs,
              marginBottom: space.md,
            }}
          >
            {list.length
              ? `${where}. Which purchase is it for?`
              : `${where}. No purchase from this payee or card in the last 120 days.`}
          </Text>
          {list.map((c) => {
            const on = c.tx.id === pick;
            const split = Array.isArray(c.tx.splits) && c.tx.splits.length;
            const sub = [
              day(c.tx.fullDate),
              split ? 'split' : c.tx.category,
              c.partRefund ? 'would be a part refund' : c.reasons.join(' and '),
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <Pressable
                key={String(c.tx.id)}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                accessibilityLabel={`${payeeOf(c.tx)}, ${formatMoney(c.tx.amount)}, ${sub}`}
                onPress={() => setPick(c.tx.id)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  borderWidth: on ? 2 : 1,
                  borderColor: on ? t.primary : t.border,
                  backgroundColor: on ? t.primarySoft : t.card,
                  borderRadius: radius.lg,
                  padding: space.md,
                  marginBottom: space.sm,
                }}
              >
                <View
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 11,
                    borderWidth: on ? 7 : 2,
                    borderColor: on ? t.primary : t.muted,
                    marginRight: space.md,
                  }}
                />
                <View style={{ flex: 1 }}>
                  <Text
                    style={{ color: t.text, fontFamily: fonts.semibold, fontSize: 16 }}
                  >{`${payeeOf(c.tx)} · ${formatMoney(c.tx.amount)}`}</Text>
                  <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 13 }}>{sub}</Text>
                </View>
                {c.best ? (
                  <View
                    style={{
                      backgroundColor: t.incomeBg,
                      borderRadius: radius.sm,
                      paddingHorizontal: space.sm,
                      paddingVertical: 2,
                    }}
                  >
                    <Text style={{ color: t.income, fontFamily: fonts.semibold, fontSize: 12 }}>
                      Best match
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
          {chosen ? (
            <View
              style={{
                backgroundColor: t.bg,
                borderRadius: radius.lg,
                padding: space.md,
                marginTop: space.xs,
                marginBottom: space.md,
              }}
            >
              <Text style={{ color: t.text, fontFamily: fonts.semibold, fontSize: 15 }}>What changes</Text>
              <Text style={{ color: t.text2, fontFamily: fonts.body, fontSize: 14, marginTop: 2 }}>
                {`${month(chosen.tx.fullDate)} ${refundCategoryOf(chosen.tx)} goes down by ${formatMoney(refund.amount)} and the refund isn't counted as income. Both stay in the list, linked to each other.`}
              </Text>
            </View>
          ) : null}
        </ScrollView>
        <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.sm }}>
          <View style={{ flex: 1 }}>
            <AppButton title="Not a refund" variant="secondary" size="lg" onPress={onNotRefund} />
          </View>
          <View style={{ flex: 1 }}>
            <AppButton
              title="Link refund"
              size="lg"
              loading={busy}
              disabled={!chosen}
              onPress={() => onLink(chosen.tx.id)}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}
