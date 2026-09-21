import {render,screen,fireEvent} from '@testing-library/react';
import {describe,it,expect,vi} from 'vitest';
import {SelectField} from './SelectField';
describe('SelectField',()=>{
 it('skips disabled options and commits keyboard selection without submitting a form',()=>{
  const onValueChange=vi.fn(),submit=vi.fn();
  render(<form onSubmit={submit}><SelectField aria-label="Качество" value="a" onValueChange={onValueChange}><option value="a">Первое</option><option value="b" disabled>Недоступно</option><option value="c">Третье</option></SelectField></form>);
  const field=screen.getByRole('combobox');
  fireEvent.keyDown(field,{key:'ArrowDown'});fireEvent.keyDown(field,{key:'ArrowDown'});fireEvent.keyDown(field,{key:'Enter'});
  expect(onValueChange).toHaveBeenCalledWith('c');expect(submit).not.toHaveBeenCalled();expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
 });
 it('closes just the popup on Escape and does not change the value',()=>{
  const change=vi.fn(),parentEscape=vi.fn();
  render(<div onKeyDown={parentEscape}><SelectField aria-label="Качество" value="a" onValueChange={change}><option value="a">Первое</option><option value="b">Второе</option></SelectField></div>);
  const field=screen.getByRole('combobox');fireEvent.click(field);fireEvent.keyDown(field,{key:'Escape'});
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();expect(change).not.toHaveBeenCalled();expect(parentEscape).not.toHaveBeenCalled();
 });
});
