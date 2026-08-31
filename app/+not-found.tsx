import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText, PrimaryButton, Screen } from '@/components/ui';
import { spacing } from '@/constants/theme';

export default function NotFoundScreen() {
  return (
    <Screen scroll={false} contentStyle={styles.content}>
      <View style={styles.copy}>
        <AppText variant="label">CAMINHO NÃO ENCONTRADO</AppText>
        <AppText variant="title">Esta tela não existe.</AppText>
        <AppText variant="bodyMuted">Volte ao início para continuar cuidando das finanças de vocês.</AppText>
      </View>
      <PrimaryButton label="Ir para o início" onPress={() => router.replace('/')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { justifyContent: 'center' },
  copy: { gap: spacing.sm },
});
