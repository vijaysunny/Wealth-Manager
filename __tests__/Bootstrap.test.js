import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import Bootstrap from '../components/Bootstrap';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const texts = (tree) => tree.root.findAllByType(Text).map((t) => [].concat(t.props.children).join(''));
const flush = () => act(async () => {});

test('children render only after the database opens', async () => {
  let tree;
  await act(async () => {
    tree = renderer.create(
      <Bootstrap open={() => Promise.resolve()}>
        <Text>APP</Text>
      </Bootstrap>
    );
  });
  expect(texts(tree)).toEqual(['APP']);
});

test('migration error shows the retry screen; retry recovers (B5)', async () => {
  const open = jest.fn().mockRejectedValueOnce(new Error('Migration count mismatch')).mockResolvedValueOnce();
  let tree;
  await act(async () => {
    tree = renderer.create(
      <Bootstrap open={open}>
        <Text>APP</Text>
      </Bootstrap>
    );
  });
  await flush();
  expect(texts(tree)).toContain('Migration count mismatch');
  const retry = tree.root.findAll((n) => n.props && n.props.title === 'Retry migration')[0];
  await act(async () => retry.props.onPress());
  await flush();
  expect(texts(tree)).toEqual(['APP']);
  expect(open).toHaveBeenCalledTimes(2);
});
