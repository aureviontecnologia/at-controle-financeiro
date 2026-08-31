import { Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { colors } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';

export default function Index() {
  const { user, loading } = useAuth();
  if (loading) {
    return <View style={styles.loading}><ActivityIndicator color={colors.mint} /></View>;
  }
  return <Redirect href={user ? '/(tabs)' : '/(auth)/login'} />;
}

const styles = StyleSheet.create({ loading: { flex: 1, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' } });
